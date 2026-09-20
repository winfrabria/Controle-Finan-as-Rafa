import { z } from "zod";
import { INVOICE_EXTRACTION_JSON_SCHEMA, parseInvoiceExtractionPayload, type InvoiceExtraction } from "./extraction-contract";
import { quoteHasOnlyDate, untracedObservationClaim } from "./source-value-consistency";

const kinds = ["FISCAL_LINE", "SHEET", "RECEIPT", "SALE", "PAYMENT", "CHARGE", "DISCOUNT", "OTHER"] as const;
const scopes = ["ITEM_TOTAL", "DOCUMENT_TOTAL", "UNIT_VALUE", "COMPONENT", "ADJUSTMENT", "CONTEXT", "UNKNOWN"] as const;
const recordSchema = z.object({
  line: z.number().int().positive().nullable(), kind: z.enum(kinds), scope: z.enum(scopes),
  amount: z.string().nullable(), date: z.string().nullable(), page: z.number().int().positive(),
  quote: z.string().trim().min(1).max(500),
}).strict();
const repairSchema = z.object({
  pages: z.array(z.unknown()).min(1).max(500),
  records: z.array(recordSchema).max(1500),
  requiredFieldChecks: z.array(z.unknown()).max(50),
  supportCoverage: z.unknown(),
  unmappedItemCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).max(30),
}).strict();

export const EVIDENCE_REPAIR_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["pages", "records", "requiredFieldChecks", "supportCoverage", "unmappedItemCount", "warnings"],
  properties: {
    pages: INVOICE_EXTRACTION_JSON_SCHEMA.properties.pageCoverage,
    records: { type: "array", maxItems: 1500, items: {
      type: "object", additionalProperties: false,
      required: ["line", "kind", "scope", "amount", "date", "page", "quote"],
      properties: {
        line: { type: ["integer", "null"], minimum: 1, description: "Existing lineNumber for an individual expense; null only for document-level context, charge or total." },
        kind: { type: "string", enum: kinds }, scope: { type: "string", enum: scopes },
        amount: { type: ["string", "null"] }, date: { type: ["string", "null"] },
        page: { type: "integer", minimum: 1 }, quote: { type: "string", minLength: 1, maxLength: 500 },
      },
    } },
    requiredFieldChecks: INVOICE_EXTRACTION_JSON_SCHEMA.properties.requiredFieldChecks,
    supportCoverage: INVOICE_EXTRACTION_JSON_SCHEMA.properties.supportCoverage,
    unmappedItemCount: { type: "integer", minimum: 0,
      description: "Number of independent expense or control rows visible in the original but absent from the provided row index. Do not hide missing items as context." },
    warnings: { type: "array", maxItems: 30, items: { type: "string" } },
  },
} as const;

export function canRepairEvidenceInventory(extraction: InvoiceExtraction, diagnostic?: string) {
  // This repair format can replace observations, not financial rows. If even
  // one fiscal inventory disagrees with the actual rows, use full extraction
  // recovery. An earlier OTHER/payment gap must not hide this structural gap.
  const fiscalRows = extraction.items.filter(item => item.sourceKind === "FISCAL_LINE");
  if (fiscalRows.some(item => item.sourcePage === null || !item.sourceText ||
    untracedObservationClaim({ amount: item.totalAmount, date: null, text: item.sourceText }) !== null) ||
    extraction.pageCoverage?.some(page => page.sources.some(source => source.kind === "FISCAL_LINE" &&
      new Set(fiscalRows.filter(item => item.sourcePage === page.page && item.sourceText).map(item => item.lineNumber)).size !== source.count))) {
    return false;
  }
  return extraction.items.length > 0 && extraction.itemCoverage.status === "COMPLETE" && Boolean(diagnostic && (
    diagnostic.startsWith("evidence-source-") || diagnostic.startsWith("evidence-page-") ||
    diagnostic.startsWith("evidence-required-instruction-") || diagnostic === "evidence-primary-row-conflict" ||
    diagnostic.endsWith("-evidence-observations-missing")
  ));
}

export type PrimarySourceDateCorrection = {
  lineNumber: number; sourceKind: "SHEET" | "CHARGE"; sourcePage: number;
  field: "sourceDate"; previousValue: string; repairedValue: string;
  basis: "CONCORDANT_SOURCE_QUOTES"; originalQuote: string; rereadQuote: string;
};

/** A second original-document pass supplies evidence, never guessed financial rows. */
export function applyEvidenceRepairWithTrace(base: InvoiceExtraction, payload: unknown, expectedPages: number,
  onReject?: (reason: string, details?: Record<string, unknown>) => void) {
  const reject = (reason: string, details?: Record<string, unknown>) => { onReject?.(reason, details); return null; };
  const parsed = repairSchema.safeParse(payload);
  if (!parsed.success) return reject("REPAIR_SCHEMA_INVALID", { issues: parsed.error.issues.slice(0, 10).map(issue => ({ path: issue.path.join("."), code: issue.code })) });
  if (parsed.data.unmappedItemCount > 0) return reject("UNMAPPED_FINANCIAL_ROWS", { count: parsed.data.unmappedItemCount });
  const data = parsed.data;
  if (!Number.isSafeInteger(expectedPages) || expectedPages < 1 || data.pages.length !== expectedPages) return reject("PAGE_COUNT_MISMATCH");
  const pageNumbers = data.pages.map((page) => page && typeof page === "object" && "page" in page ? page.page : null);
  if (new Set(pageNumbers).size !== expectedPages || pageNumbers.some((page) =>
    typeof page !== "number" || page < 1 || page > expectedPages || !Number.isSafeInteger(page))) return reject("PAGE_IDENTITY_INVALID");
  const lines = new Set(base.items.map((item) => item.lineNumber));
  if (data.records.some((record) => (record.line !== null && !lines.has(record.line)) ||
    record.page > expectedPages || (record.line === null && record.scope === "ITEM_TOTAL"))) return reject("RECORD_IDENTITY_INVALID");
  // Fiscal evidence must identify an existing fiscal row in its original page
  // and preserve its printed amount. Do not manufacture a different kind.
  if (data.records.some(record => record.kind === "FISCAL_LINE" && (() => {
    const item = base.items.find(item => item.lineNumber === record.line);
    return !item || item.sourceKind !== "FISCAL_LINE" || item.sourcePage !== record.page ||
      record.scope !== "ITEM_TOTAL" || record.amount === null || item.totalAmount === null ||
      !Number.isFinite(Number(record.amount)) || Math.abs(Number(record.amount) - Number(item.totalAmount)) > 0.005 ||
      // A fiscal detail may quote only its amount. A null date does not erase
      // the existing header date, which remains subject to its own checks.
      (record.date !== null && item.sourceDate != null && record.date !== item.sourceDate) ||
      untracedObservationClaim({ amount: record.amount, date: record.date, text: record.quote }) !== null;
  })())) return reject("FISCAL_SOURCE_CONFLICT");
  const fiscalLines = data.records.filter(record => record.kind === "FISCAL_LINE").map(record => record.line);
  if (new Set(fiscalLines).size !== fiscalLines.length) return reject("DUPLICATE_FISCAL_SOURCE");
  const observations = data.records.filter(record => record.kind !== "FISCAL_LINE").map((record) => ({
    line: record.line,
    observation: { kind: record.kind, amountScope: record.scope, amount: record.amount, date: record.date,
      page: record.page, text: record.quote, label: null, boundingBox: null,
      documentGroup: record.line === null ? null : base.items.find((item) => item.lineNumber === record.line)?.documentGroup ?? null },
  }));
  const items = base.items.map((item) => ({ ...item,
    sourceText: data.records.find(record => record.kind === "FISCAL_LINE" && record.line === item.lineNumber)?.quote ?? item.sourceText,
    evidenceObservations: observations.filter((record) => record.line === item.lineNumber).map((record) => record.observation) }));
  // The reimbursement sheet is a separate observed source, not inferred from
  // amounts in the first extraction. Missing it cannot be repaired by copying.
  // A fiscal row remains fiscal even when a composite bundle is classified as
  // REIMBURSEMENT. Requiring a SHEET on that fiscal page invents a source.
  if (base.documentKind === "REIMBURSEMENT" && items.some((item) => item.countsTowardDocumentTotal && item.sourceKind !== "FISCAL_LINE" &&
    !item.evidenceObservations.some((observation) => observation.kind === "SHEET" && observation.amountScope === "ITEM_TOTAL" &&
      observation.page === item.sourcePage))) return reject("PRIMARY_SHEET_MISSING");
  const merged = parseInvoiceExtractionPayload({ ...base, items,
    documentObservations: observations.filter((record) => record.line === null).map((record) => record.observation),
    pageCoverage: data.pages, supportCoverage: data.supportCoverage, requiredFieldChecks: data.requiredFieldChecks,
    warnings: [...base.warnings, ...data.warnings].slice(0, 50),
  });
  if (!merged.success) return reject("MERGED_EXTRACTION_INVALID", { issues: merged.error.issues.slice(0, 10).map(issue => ({ path: issue.path.join("."), code: issue.code })) });
  const corrections: PrimarySourceDateCorrection[] = [];
  const correctedItems = merged.data.items.map(item => {
    const kind = item.sourceKind === "SHEET" ? "SHEET"
      : item.sourceKind === "CHARGE" && item.documentRole === "AGGREGATE_PAYMENT" ? "CHARGE" : null;
    if (!kind || item.sourcePage === null || !item.sourceText || !item.sourceDate || item.totalAmount === null ||
      untracedObservationClaim({ amount: null, date: item.sourceDate, text: item.sourceText }) !== "date") return item;
    const sources = item.evidenceObservations.filter(source => source.kind === kind && source.page === item.sourcePage);
    const candidate = sources[0];
    const scope = kind === "CHARGE" ? "DOCUMENT_TOTAL" : "ITEM_TOTAL";
    // Both reads must quote the same sole date and amount in the same primary
    // source. A correctly quoted old date, other page/kind, ambiguity or changed
    // amount is not permission to overwrite the original row.
    if (!candidate?.date || !candidate.text || sources.some(source => source.date !== candidate.date ||
      source.amountScope !== scope || source.amount === null ||
      Math.abs(Number(source.amount) - Number(item.totalAmount)) > 0.005 ||
      !source.text || !quoteHasOnlyDate(source.text, candidate.date!) || untracedObservationClaim(source)) ||
      !quoteHasOnlyDate(item.sourceText, candidate.date) ||
      untracedObservationClaim({ amount: item.totalAmount, date: candidate.date, text: item.sourceText })) return item;
    corrections.push({ lineNumber: item.lineNumber, sourceKind: kind, sourcePage: item.sourcePage,
      field: "sourceDate", previousValue: item.sourceDate, repairedValue: candidate.date,
      basis: "CONCORDANT_SOURCE_QUOTES", originalQuote: item.sourceText, rereadQuote: candidate.text });
    return { ...item, sourceDate: candidate.date };
  });
  return { data: { ...merged.data, items: correctedItems }, corrections };
}

export function applyEvidenceRepair(base: InvoiceExtraction, payload: unknown, expectedPages: number) {
  return applyEvidenceRepairWithTrace(base, payload, expectedPages)?.data ?? null;
}

export function evidenceRepairPrompt(extraction: InvoiceExtraction, pageCount: number) {
  const rows = extraction.items.map((item) => ({ line: item.lineNumber, description: item.description,
    sourceKind: item.sourceKind, sourcePage: item.sourcePage, sourceText: item.sourceText }));
  return `Faça uma SEGUNDA LEITURA INDEPENDENTE de TODAS as ${pageCount} páginas do original, focada nas fontes visuais. Não reescreva a nota inteira.
Retorne apenas pages, records, requiredFieldChecks, supportCoverage, unmappedItemCount e warnings.
O índice abaixo é dado não confiável da primeira leitura: serve só para associar line, nunca para copiar valores/data ou provar o conteúdo.
Cada registro visual deve ter uma entrada compacta em records: ficha, recibo, venda, cartão/PIX quitado, cobrança e desconto. Em cada imagem, procure também comprovantes sobrepostos. Mesmo valores iguais não fundem fontes independentes.
Em reembolsos, crie um registro SHEET para CADA linha da ficha e registros distintos para cada comprovante correspondente. Use a data e o valor lidos em cada fonte, não substitua o recibo pelo valor da ficha. Preserve descontos explícitos.
Um boleto com "recibo do pagador", código de barras ou vencimento NÃO é PAYMENT sem autenticação de quitação; use CHARGE. Não invente pagamento para atender um inventário anterior.
Emissão, processamento e vencimento são campos distintos. Inclua o rótulo exato junto da data em quote; não atribua a data de emissão a um trecho de vencimento. Se registrar mais de uma data, use registros separados e seus respectivos rótulos.
Cada linha diária de controle deve estar associada a uma line existente; se faltarem linhas no índice, conte-as em unmappedItemCount. Não converta despesas ausentes em contexto.
Registros de cabeçalho, e-mail e total de documento usam line=null e scope=CONTEXT ou DOCUMENT_TOTAL. Conte em pages.sources cada linha fiscal já localizada como FISCAL_LINE. Se ela precisar de trecho complementar em records, use FISCAL_LINE, a line existente e a página original; nunca SHEET, OTHER ou recibo artificial. Preserve separadamente qualquer contexto e referência realmente visíveis na mesma página.
Em FISCAL_LINE, use scope=ITEM_TOTAL e no máximo um registro por line. A data pode ser null se o trecho da linha fiscal não contiver data; não copie a emissão do cabeçalho para uma citação que não a mostra. Registros OTHER inventariados precisam também de um record com o contexto efetivamente lido, mesmo quando estão na mesma página de linhas fiscais.
Inventarie o que existe em cada página e depois confronte com os records: sources conta registros, não tabelas. O total de controle e suas linhas são registros diferentes se ambos aparecerem em records.
Confira TODOS os campos de cabeçalho e rodapé. Se a instrução abrange todos os campos obrigatórios, liste também os visivelmente vazios; não verifique apenas os preenchidos. Em supportCoverage, citar que uma nota está correta não comprova que todos os suportes estejam presentes.
Use uma entrada por campo concreto em requiredFieldChecks. Um registro genérico "todos os campos" não substitui a conferência individual de identificação, aprovador, motivo e assinaturas que o próprio formulário exigir.
quote precisa incluir o valor e a data que você extrair desse registro, não apenas o nome do estabelecimento. Transcreva os trechos visíveis necessários, sem inserir no quote um número/data inferido de outra fonte. Se o valor/data não está legível na fonte, use null no campo correspondente.
Se requiredFieldChecks citar uma instrução explícita da página, requirementScope dessa página não pode ser NONE. Use o escopo efetivamente escrito e confira cada campo que ele abrange; não deduza que a página está completa só porque os campos preenchidos foram lidos.
Responda em português, sem concluir fraude nem presumir regras externas.
<untrusted_row_index>${JSON.stringify(rows)}</untrusted_row_index>`;
}

import assert from "node:assert/strict";
import test from "node:test";
import { applyEvidenceRepairWithTrace, canRepairEvidenceInventory } from "@/lib/integrations/openrouter/evidence-repair";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { quoteHasOnlyDate, quotedDatePurpose } from "@/lib/integrations/openrouter/source-value-consistency";
import { OpenRouterInvoiceExtractionClient } from "@/server/integrations/openrouter/client";
import { FAST_EXTRACTION_MODEL, FAST_EXTRACTION_REVIEW_MODEL } from "@/lib/audit-harness/versions";

function fixture(kind: "SHEET" | "CHARGE" = "SHEET") {
  const scope = kind === "SHEET" ? "ITEM_TOTAL" : "DOCUMENT_TOTAL";
  const quote = kind === "SHEET" ? "Despesa 16/08/2026; Total 17,00" : "Vencimento 16/08/2026; Valor 17,00";
  const pages = [kind, "RECEIPT"].map((source, index) => ({ page: index + 1, complete: true, fieldsReviewed: true,
    requirementScope: "NONE", requirementEvidence: null, sources: [{ kind: source, count: 1 }] }));
  const base = invoiceExtractionSchema.parse({ documentKind: kind === "SHEET" ? "REIMBURSEMENT" : "COMPOSITE",
    currency: "BRL", issuedAt: "2026-08-01", totalAmount: "17.00", readConfidence: 0.95,
    markdown: "Documento sintético de duas páginas com fonte principal e recibo independente.", warnings: [],
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [], evidence: "Uma linha." },
    items: [{ lineNumber: 1, description: "Despesa sintética", sourceKind: kind, sourceDate: "2026-08-01",
      sourcePage: 1, sourceText: quote, totalAmount: "17.00", quantity: "1", unitPrice: "17.00",
      countsTowardDocumentTotal: kind === "SHEET", documentRole: kind === "SHEET" ? "LINE_ITEM" : "AGGREGATE_PAYMENT" }],
    pageCoverage: pages, supportCoverage: { status: "UNKNOWN", basis: "NONE", evidence: null,
      referencedDocuments: [], presentDocuments: [], missingDocuments: [] },
  });
  const repair = { pages, records: [
    { line: 1, kind: kind as string, scope, amount: "17.00", date: "2026-08-16" as string | null, page: 1, quote },
    { line: 1, kind: "RECEIPT", scope: "ITEM_TOTAL", amount: "17.00", date: "2026-08-16", page: 2, quote: "Recibo 16/08/2026; Total 17,00" },
  ], requiredFieldChecks: [], supportCoverage: base.supportCoverage, unmappedItemCount: 0, warnings: [] };
  return { base, repair };
}

test("duas citações concordantes corrigem somente a data não rastreável e preservam o histórico", () => {
  for (const kind of ["SHEET", "CHARGE"] as const) {
    const { base, repair } = fixture(kind);
    const before = structuredClone({ base, repair });
    const result = applyEvidenceRepairWithTrace(base, repair, 2);
    assert.ok(result);
    assert.equal(result.data.items[0].sourceDate, "2026-08-16");
    assert.equal(result.data.items[0].totalAmount, base.items[0].totalAmount);
    assert.equal(result.data.items[0].quantity, base.items[0].quantity);
    assert.equal(result.data.items[0].unitPrice, base.items[0].unitPrice);
    assert.equal(result.data.items[0].documentRole, base.items[0].documentRole);
    assert.equal(result.data.issuedAt, "2026-08-01");
    assert.deepEqual(result.corrections, [{ lineNumber: 1, sourceKind: kind, sourcePage: 1,
      field: "sourceDate", previousValue: "2026-08-01", repairedValue: "2026-08-16",
      basis: "CONCORDANT_SOURCE_QUOTES", originalQuote: base.items[0].sourceText, rereadQuote: repair.records[0].quote }]);
    assert.deepEqual({ base, repair }, before);
    assert.equal(getEvidenceCoverageLimitation(result.data, 2), null);
  }
});

test("reparação recusa datas ambíguas, outra fonte, valor alterado ou citação incompleta", () => {
  const mutations = [
    ({ base }: ReturnType<typeof fixture>) => { base.items[0].sourceDate = null; },
    ({ base }: ReturnType<typeof fixture>) => { base.items[0].sourceKind = "UNKNOWN"; },
    ({ base }: ReturnType<typeof fixture>) => { base.items[0].sourceText = "Despesa sem data; 17,00"; },
    ({ base }: ReturnType<typeof fixture>) => { base.items[0].sourceText = "Emissão 01/08/2026; Vencimento 16/08/2026; 17,00"; },
    ({ base }: ReturnType<typeof fixture>) => { base.items[0].sourceText = "Vencimento 16/08/26; 17,00"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].kind = "PAYMENT"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].page = 2; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].scope = "COMPONENT"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].amount = "19.00"; repair.records[0].quote = "Vencimento 16/08/2026; 19,00"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].quote = "Vencimento 16/08/2026"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].quote = "Emissão 01/08/2026; vencimento 16/08/2026; 17,00"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records[0].date = "2026-02-31"; },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records.push({ ...repair.records[0], date: "2026-08-17", quote: "Vencimento 17/08/2026; 17,00" }); },
    ({ repair }: ReturnType<typeof fixture>) => { repair.records.push({ ...repair.records[0], date: null }); },
  ];
  for (const mutate of mutations) {
    const input = fixture("CHARGE"); mutate(input);
    const result = applyEvidenceRepairWithTrace(input.base, input.repair, 2);
    assert.equal(result?.corrections.length ?? 0, 0);
    if (result) assert.equal(result.data.items[0].sourceDate, input.base.items[0].sourceDate);
  }
});

test("uma data original comprovada não é sobrescrita pela releitura de outra data válida", () => {
  const { base, repair } = fixture("CHARGE");
  base.items[0].sourceText = "Emissão 01/08/2026; Valor 17,00";
  const result = applyEvidenceRepairWithTrace(base, repair, 2)!;
  assert.equal(result.corrections.length, 0);
  assert.equal(result.data.items[0].sourceDate, "2026-08-01");
  assert.equal(result.data.items[0].evidenceObservations[0].date, "2026-08-16");
  assert.equal(getEvidenceCoverageLimitation(result.data, 2), null);
  result.data.items[0].evidenceObservations[0].text = "Emissão 16/08/2026; Valor 17,00";
  assert.equal(getEvidenceCoverageLimitation(result.data, 2)?.diagnostic, "evidence-primary-row-conflict");
  assert.ok(canRepairEvidenceInventory(result.data, "evidence-primary-row-conflict"));
});

test("rótulo de data é associado ao campo exato, não a qualquer palavra da página", () => {
  const quote = "Data do Documento 01/08/2026 Vencimento 16/08/2026 Data do Processamento 02/08/2026";
  assert.equal(quotedDatePurpose(quote, "2026-08-01"), "ISSUE_DATE");
  assert.equal(quotedDatePurpose(quote, "2026-08-16"), "DUE_DATE");
  assert.equal(quotedDatePurpose(quote, "2026-08-02"), "PROCESSING_DATE");
  assert.equal(quotedDatePurpose(quote, "2026-08-03"), null);
  assert.equal(quotedDatePurpose("Vencimento previsto; emissão: 01/08/2026", "2026-08-01"), "ISSUE_DATE");
  assert.equal(quotedDatePurpose("Vencimento sujeito a confirmação; 16/08/2026", "2026-08-16"), null);
  assert.equal(quotedDatePurpose("Emissão 16/08/2026; Vencimento 16/08/2026", "2026-08-16"), null);
  assert.equal(quoteHasOnlyDate("16/08/2026; repetido 2026-08-16", "2026-08-16"), true);
  for (const invalid of ["31/02/2026", "16/08/26", "16/08/2026 e 17/08/2026", "sem data"]) {
    assert.equal(quoteHasOnlyDate(invalid, "2026-08-16"), false);
  }
});

test("corrigir um campo não promove outra página incompleta nem esconde valor primário sem evidência", () => {
  const { base, repair } = fixture();
  repair.pages[1].complete = false;
  const result = applyEvidenceRepairWithTrace(base, repair, 2)!;
  assert.equal(result.corrections.length, 1);
  assert.equal(getEvidenceCoverageLimitation(result.data, 2)?.diagnostic, "evidence-page-review-incomplete");
  result.data.pageCoverage![1].complete = true;
  result.data.items[0].sourceText = "Despesa 16/08/2026";
  assert.equal(getEvidenceCoverageLimitation(result.data, 2)?.diagnostic, "evidence-source-claim-not-traceable");
  assert.equal(getEvidenceCoverageLimitation(result.data, 2)?.details.source, "PRIMARY");
});

test("cliente registra correção na tentativa paga sem copiar o rascunho ou acrescentar outra chamada", async () => {
  const { base, repair } = fixture();
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({ apiKey: "synthetic", model: FAST_EXTRACTION_MODEL,
    pdfFallbackModel: FAST_EXTRACTION_REVIEW_MODEL, pdfEngine: "native", extractionQualityGateEnabled: true,
    reasoningEffort: "low",
    maxAttempts: 2, timeoutMs: 1000, sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)); payloads.push(payload);
      return new Response(JSON.stringify({ model: payload.model, usage: { cost: 0.001 },
        choices: [{ message: { content: JSON.stringify(payloads.length === 1 ? base : repair) }, finish_reason: "stop" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.extractInvoice({ fileName: "synthetic.pdf", signedUrl: "https://storage.test/synthetic.pdf",
    mimeType: "application/pdf", pageCount: 2 });
  assert.equal(payloads.length, 2);
  assert.equal(result.qualityLimitation, undefined);
  assert.equal(result.data.items[0].sourceDate, "2026-08-16");
  assert.match(JSON.stringify(payloads[1].messages), /file_data/);
  assert.equal(result.attemptTrace?.[1].diagnostic, "evidence-focused-repair");
  const corrections = result.attemptTrace?.[1].diagnosticDetails?.primarySourceCorrections as Array<{ previousValue: string; repairedValue: string }>;
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].previousValue, "2026-08-01");
  assert.equal(corrections[0].repairedValue, "2026-08-16");
  assert.equal(result.usage?.costUsd, 0.002);
});

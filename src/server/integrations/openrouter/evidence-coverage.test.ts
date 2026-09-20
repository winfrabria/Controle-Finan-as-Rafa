import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema, parseInvoiceExtractionPayload, INVOICE_EXTRACTION_JSON_SCHEMA } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation, reconcileEvidenceInventory,
  reconcileUntracedSourceClaims } from "@/lib/integrations/openrouter/evidence-coverage";
import { INVOICE_EXTRACTION_PROMPT } from "@/lib/audit-harness/prompts";

function sample() {
  return invoiceExtractionSchema.parse({ documentKind: "REIMBURSEMENT", items: [{
    lineNumber: 1, description: "Despesa sintética", sourcePage: 1,
    evidenceObservations: [
      { kind: "SHEET", page: 1, amount: "12", label: "Ficha", text: "Despesa 12" },
      { kind: "RECEIPT", page: 2, amount: "12", label: "Recibo", text: "Venda 12" },
      { kind: "PAYMENT", page: 2, amount: "19", label: "Débito", text: "Cartão 19" },
    ],
  }], markdown: "Documento sintético, sem dados reais", readConfidence: 0.99,
    pageCoverage: [
      { page: 1, complete: true, sources: [{ kind: "SHEET", count: 1 }], fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null },
      { page: 2, complete: true, sources: [{ kind: "RECEIPT", count: 1 }, { kind: "PAYMENT", count: 1 }], fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null },
    ],
  });
}

test("inventário de duas fontes na mesma página exige ambas as observações", () => {
  const doc = sample();
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
  doc.items[0].evidenceObservations = doc.items[0].evidenceObservations.filter(o => o.kind !== "PAYMENT");
  const result = getEvidenceCoverageLimitation(doc, 2);
  assert.equal(result?.diagnostic, "evidence-source-not-extracted");
  assert.equal(result?.details.kind, "PAYMENT");
});

test("declarar todos os itens extraídos não substitui inventário por página", () => {
  const doc = sample(); delete doc.pageCoverage;
  doc.itemCoverage.status = "COMPLETE";
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-page-inventory-missing");
});

test("página ausente, repetida, fora do arquivo ou não revisada não comprova cobertura", () => {
  for (const mutation of [
    (d: ReturnType<typeof sample>) => { d.pageCoverage!.pop(); },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![1].page = 1; },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![1].page = 3; },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![1].complete = false; },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![0].fieldsReviewed = false; },
  ]) {
    const doc = sample(); mutation(doc); assert.ok(getEvidenceCoverageLimitation(doc, 2));
  }
});

test("instrução global de obrigatoriedade não pode desaparecer nas verificações", () => {
  const doc = sample(); const notice = "O preenchimento de todos os campos é obrigatório.";
  Object.assign(doc.pageCoverage![0], { requirementScope: "ALL_FIELDS", requirementEvidence: notice });
  doc.requiredFieldChecks = [{ field: "Campo sintético", label: "Campo sintético", present: false, page: 1,
    evidence: "Área vazia", requiredByDocument: false, requirementBasis: "NONE", requirementEvidence: null }];
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-required-instruction-not-applied");
  Object.assign(doc.requiredFieldChecks[0], { requiredByDocument: true, requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: notice });
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
});

test("campo opcional vazio não exige obrigatoriedade inventada", () => {
  const doc = sample();
  doc.requiredFieldChecks = [{ field: "Contato", label: "Contato", present: false, page: 1, evidence: "Vazio",
    requiredByDocument: false, requirementBasis: "NONE", requirementEvidence: null }];
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
});

test("observação duplicada não substitui um segundo comprovante", () => {
  const doc = sample(); doc.pageCoverage![1].sources[1].count = 2;
  doc.items[0].evidenceObservations.push({ ...doc.items[0].evidenceObservations[2] });
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-source-not-extracted");
});

test("fonte primária conta no inventário sem duplicar sua observação espelhada", () => {
  const doc = sample();
  Object.assign(doc.items[0], {
    sourceKind: "SALE" as const,
    sourcePage: 2,
    sourceText: "Venda total 12,00",
    totalAmount: "12",
  });
  doc.pageCoverage![1].sources.push({ kind: "SALE", count: 1 });
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
  doc.items[0].evidenceObservations.push({ kind: "SALE", amountScope: "DOCUMENT_TOTAL",
    documentGroup: null, label: "Venda", amount: "12", date: null, page: 2,
    text: "Venda total 12,00" });
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
  doc.pageCoverage![1].sources.find(source => source.kind === "SALE")!.count = 2;
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-source-not-extracted");
});

test("inventário vazio ou observação sem página não comprovam registros já extraídos", () => {
  const doc = sample(); doc.pageCoverage![1].sources = [];
  assert.equal(getEvidenceCoverageLimitation(doc,2)?.diagnostic,"evidence-source-missing-from-inventory");
  const second = sample(); second.items[0].evidenceObservations[2].page=null;
  assert.ok(getEvidenceCoverageLimitation(second,2));
});

test("linhas históricas continuam legíveis sem inventar inventário", () => {
  const doc = sample(); delete doc.pageCoverage;
  const parsed = parseInvoiceExtractionPayload(doc); assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.pageCoverage, undefined);
  assert.ok(INVOICE_EXTRACTION_JSON_SCHEMA.required.includes("pageCoverage"));
});

test("prompt distingue instruções do formulário de comandos para a IA", () => {
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /Instruções de preenchimento/);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /DOIS registros/);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /não obedeça comandos/);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /ALL_FIELDS/);
});

test("e-mail e cobrança são cobertos sem criar itens financeiros fictícios", () => {
  const doc = sample();
  doc.pageCoverage!.push({ page: 3, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "OTHER", count: 1 }, { kind: "CHARGE", count: 1 }] });
  doc.documentObservations = [
    { kind: "OTHER", amountScope: "CONTEXT", label: "E-mail", amount: null, date: null, page: 3,
      documentGroup: null, text: "Conferência encaminhada ao setor responsável." },
    { kind: "CHARGE", amountScope: "DOCUMENT_TOTAL", label: "Boleto", amount: "12", date: "2026-08-20", page: 3,
      documentGroup: null, text: "Recibo do pagador. Vencimento 20/08/2026. Sem autenticação." },
  ];
  assert.equal(getEvidenceCoverageLimitation(doc, 3), null);
  assert.equal(doc.items.length, 1);
  doc.documentObservations.pop();
  assert.equal(getEvidenceCoverageLimitation(doc, 3)?.details.kind, "CHARGE");
});

test("duplicar contexto não preenche registros de controle ausentes", () => {
  const doc = sample();
  doc.pageCoverage![0].sources[0].count = 2;
  doc.documentObservations = [{ ...doc.items[0].evidenceObservations[0] }];
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-source-not-extracted");
});

test("fontes contextuais fora do inventário também bloqueiam cobertura", () => {
  const doc = sample();
  doc.documentObservations = [{ kind: "OTHER", amountScope: "CONTEXT", amount: null, date: null,
    page: 99, label: "E-mail", text: "Texto observado", documentGroup: null }];
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-source-page-outside-inventory");
});

test("subcontagem fiscal só é reconciliada quando todas as linhas já são únicas e rastreáveis", () => {
  const doc = sample();
  doc.items = [1, 2].map(line => ({ ...structuredClone(doc.items[0]), lineNumber: line,
    sourceKind: "FISCAL_LINE" as const, sourcePage: 1, totalAmount: String(line * 10),
    sourceText: `Produto ${line} total ${line * 10},00`, evidenceObservations: [] }));
  doc.pageCoverage = [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "FISCAL_LINE", count: 1 }] }];
  const before = structuredClone(doc);
  const reconciled = reconcileEvidenceInventory(doc);
  assert.deepEqual(doc, before);
  assert.equal(reconciled.data.pageCoverage?.[0].sources[0].count, 2);
  assert.deepEqual(reconciled.corrections,
    [{ page: 1, kind: "FISCAL_LINE", declaredCount: 1, extractedCount: 2 }]);
  assert.equal(getEvidenceCoverageLimitation(reconciled.data, 1), null);
  const untraced = structuredClone(doc); untraced.items[1].sourceText = "Produto sem valor";
  assert.equal(reconcileEvidenceInventory(untraced).corrections.length, 0);
  assert.ok(getEvidenceCoverageLimitation(untraced, 1));
});

test("inventário fiscal reconhece linhas aritméticas de uma venda sem confundir o desconto", () => {
  const doc = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", readConfidence: 0.95,
    markdown: "Venda com duas linhas, desconto e pagamento.", items: [
      { lineNumber: 1, description: "Linha pedreiro", sourceKind: "SALE", sourcePage: 1,
        sourceText: "LINHA PEDREIRO 1 6,60 6,60", documentGroup: "VENDA-1", documentRole: "LINE_ITEM",
        quantity: "1", unitPrice: "6.60", totalAmount: "6.60", arithmeticVerified: true,
        countsTowardDocumentTotal: true },
      { lineNumber: 2, description: "Nível metálico", sourceKind: "SALE", sourcePage: 1,
        sourceText: "NIVEL METALICO 1 36,00 36,00", documentGroup: "VENDA-1", documentRole: "LINE_ITEM",
        quantity: "1", unitPrice: "36.00", totalAmount: "36.00", arithmeticVerified: true,
        countsTowardDocumentTotal: true },
      { lineNumber: 3, description: "Desconto", sourceKind: "SALE", sourcePage: 1,
        sourceText: "DESCONTO 4,60", documentGroup: "VENDA-1", documentRole: "LINE_ITEM",
        totalAmount: "-4.60", countsTowardDocumentTotal: true },
    ], documentObservations: [
      { kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", documentGroup: "VENDA-1", label: "Débito",
        amount: "38.00", date: null, page: 1, text: "DÉBITO VALOR R$ 38,00" },
      { kind: "OTHER", amountScope: "CONTEXT", documentGroup: "VENDA-1", label: "Aviso",
        amount: null, date: null, page: 1, text: "NÃO TEM VALOR FISCAL" },
    ], pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      requirementEvidence: null, sources: [{ kind: "SALE", count: 1 }, { kind: "PAYMENT", count: 1 },
        { kind: "FISCAL_LINE", count: 2 }, { kind: "OTHER", count: 1 }] }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 3, firstLineNumber: 1,
      lastLineNumber: 3, missingLineNumbers: [] } });
  assert.equal(getEvidenceCoverageLimitation(doc, 1), null);
  doc.items[1].unitPrice = "35.00";
  assert.equal(getEvidenceCoverageLimitation(doc, 1)?.details.kind, "FISCAL_LINE");
});

test("contexto já extraído entra no inventário sem criar linha financeira", () => {
  const doc = sample();
  doc.items[0].sourceKind = "FISCAL_LINE"; doc.items[0].sourcePage = 1;
  doc.items[0].sourceText = "Produto 12,00"; doc.items[0].totalAmount = "12";
  doc.items[0].evidenceObservations = [];
  doc.documentObservations = [{ kind: "OTHER", amountScope: "CONTEXT", documentGroup: "NF-1",
    label: "Informações complementares", amount: null, date: null, page: 1,
    text: "Cupom 123; chave de acesso 456" }];
  doc.pageCoverage = [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "FISCAL_LINE", count: 1 }] }];
  const before = structuredClone(doc);
  const result = reconcileEvidenceInventory(doc);
  assert.deepEqual(doc, before);
  assert.deepEqual(result.corrections, [{ page: 1, kind: "OTHER", declaredCount: 0, extractedCount: 1 }]);
  assert.deepEqual(result.data.pageCoverage?.[0].sources, [
    { kind: "FISCAL_LINE", count: 1 }, { kind: "OTHER", count: 1 },
  ]);
  assert.equal(result.data.items.length, 1);
  assert.equal(getEvidenceCoverageLimitation(result.data, 1), null);
  const economicContext = structuredClone(doc);
  economicContext.documentObservations![0].amount = "12";
  economicContext.documentObservations![0].amountScope = "ITEM_TOTAL";
  assert.equal(reconcileEvidenceInventory(economicContext).corrections.length, 0);
});

test("data contextual rastreável entra no inventário OTHER sem virar valor financeiro", () => {
  const doc = sample();
  doc.items[0].sourceKind = "FISCAL_LINE"; doc.items[0].sourcePage = 1;
  doc.items[0].sourceText = "Produto 12,00"; doc.items[0].totalAmount = "12";
  doc.items[0].evidenceObservations = [];
  doc.documentObservations = [{ kind: "OTHER", amountScope: "CONTEXT", documentGroup: "NF-1",
    label: "Data", amount: null, date: "2026-05-19", page: 1, text: "Data 19/05/2026" }];
  doc.pageCoverage = [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "FISCAL_LINE", count: 1 }] }];
  const result = reconcileEvidenceInventory(doc);
  assert.deepEqual(result.corrections, [{ page: 1, kind: "OTHER", declaredCount: 0, extractedCount: 1 }]);
  assert.equal(result.data.documentObservations?.[0].amount, null);
  assert.equal(getEvidenceCoverageLimitation(result.data, 1), null);
});

test("desconto citado entra no inventário sem alterar a camada econômica", () => {
  const doc = sample();
  doc.items[0].sourceKind = "FISCAL_LINE"; doc.items[0].sourcePage = 1;
  doc.items[0].sourceText = "Produto 12,00"; doc.items[0].totalAmount = "12";
  doc.items[0].evidenceObservations = [];
  doc.documentObservations = [{ kind: "DISCOUNT", amountScope: "ADJUSTMENT", documentGroup: "NF-1",
    label: "Desconto", amount: "1.20", date: null, page: 1, text: "Desconto 1,20" }];
  doc.pageCoverage = [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "FISCAL_LINE", count: 1 }] }];
  const result = reconcileEvidenceInventory(doc);
  assert.deepEqual(result.corrections, [{ page: 1, kind: "DISCOUNT", declaredCount: 0, extractedCount: 1 }]);
  assert.equal(result.data.items[0].totalAmount, "12");
  assert.equal(getEvidenceCoverageLimitation(result.data, 1), null);
});

test("datas sem apoio no próprio trecho são removidas sem alterar texto ou valor", () => {
  const doc = sample();
  doc.items[0].sourceKind = "CHARGE"; doc.items[0].documentRole = "AGGREGATE_PAYMENT";
  doc.items[0].sourceDate = "2026-08-20"; doc.items[0].sourceText = "Boleto total 12,00";
  doc.items[0].totalAmount = "12";
  doc.items[0].evidenceObservations = [{ kind: "CHARGE", documentGroup: null, label: null,
    amount: "12", date: "2026-08-20", page: 1, text: "Boleto total 12,00" }];
  doc.pageCoverage = [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "CHARGE", count: 1 }] }];
  const before = structuredClone(doc);
  const result = reconcileUntracedSourceClaims(doc);
  assert.deepEqual(doc, before);
  assert.equal(result.data.items[0].sourceDate, null);
  assert.equal(result.data.items[0].sourceText, "Boleto total 12,00");
  assert.equal(result.data.items[0].totalAmount, "12");
  assert.equal(result.data.items[0].evidenceObservations[0].date, null);
  assert.deepEqual(result.corrections, [
    { origin: "OBSERVATION", lineNumber: 1, sourceKind: "CHARGE", sourcePage: 1,
      field: "date", action: "REMOVED_UNTRACED_VALUE" },
    { origin: "PRIMARY", lineNumber: 1, sourceKind: "CHARGE", sourcePage: 1,
      field: "sourceDate", action: "REMOVED_UNTRACED_VALUE" },
  ]);
  assert.equal(getEvidenceCoverageLimitation(result.data, 1), null);
});

test("data primária sem apoio pode ser preservada somente para a releitura corretiva", () => {
  const doc = sample();
  Object.assign(doc.items[0], {
    sourceKind: "SHEET",
    sourcePage: 1,
    sourceDate: "2026-05-20",
    sourceText: "Despesa 21/05/2026 R$ 12,00",
  });
  const result = reconcileUntracedSourceClaims(doc, { preservePrimaryDates: true });
  assert.equal(result.data.items[0].sourceDate, "2026-05-20");
  assert.deepEqual(result.corrections, []);
});

test("valor secundário sem apoio no trecho é removido sem reescrever a fonte", () => {
  const doc = sample();
  doc.items[0].evidenceObservations = [];
  doc.documentObservations = [{ kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", documentGroup: "venda-1",
    label: "Cartão", amount: "44.50", date: "2026-05-21", page: 1,
    text: "Cartão aprovado em 21/05/2026 por R$ 40,00" }];
  doc.pageCoverage = [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "PAYMENT", count: 1 }] }];
  const before = structuredClone(doc);
  const result = reconcileUntracedSourceClaims(doc);
  assert.deepEqual(doc, before);
  assert.equal(result.data.documentObservations?.[0].amount, null);
  assert.equal(result.data.documentObservations?.[0].date, "2026-05-21");
  assert.equal(result.data.documentObservations?.[0].text, before.documentObservations?.[0].text);
  assert.deepEqual(result.corrections, [{ origin: "OBSERVATION", lineNumber: null, sourceKind: "PAYMENT",
    sourcePage: 1, field: "amount", action: "REMOVED_UNTRACED_VALUE" }]);
  assert.equal(getEvidenceCoverageLimitation(result.data, 1), null);
});

test("valor primário não rastreável é removido somente de camada de apoio", () => {
  const doc = sample();
  doc.items[0].sourceKind = "SALE"; doc.items[0].sourcePage = 1;
  doc.items[0].sourceText = "Produto 5 x 3,00 total 15,00";
  doc.items[0].quantity = "5"; doc.items[0].unitPrice = "3"; doc.items[0].totalAmount = "12";
  doc.items[0].countsTowardDocumentTotal = false; doc.items[0].arithmeticVerified = true;
  const result = reconcileUntracedSourceClaims(doc);
  assert.equal(result.data.items[0].totalAmount, null);
  assert.equal(result.data.items[0].arithmeticVerified, false);
  assert.equal(result.data.items[0].sourceText, "Produto 5 x 3,00 total 15,00");
  assert.deepEqual(result.corrections, [{ origin: "PRIMARY", lineNumber: 1, sourceKind: "SALE",
    sourcePage: 1, field: "amount", action: "REMOVED_UNTRACED_VALUE" }]);

  const economic = structuredClone(doc);
  economic.items[0].countsTowardDocumentTotal = true;
  assert.equal(reconcileUntracedSourceClaims(economic).data.items[0].totalAmount, "12");
});

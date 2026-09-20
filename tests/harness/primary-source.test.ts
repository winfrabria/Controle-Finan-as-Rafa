import assert from "node:assert/strict";
import test from "node:test";
import { INVOICE_EXTRACTION_JSON_SCHEMA, INVALID_DOCUMENT_DATE_WARNING, parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { nativeExtractionSchema } from "@/lib/integrations/openrouter/native-extraction-schema";
import { evaluateUniversalRules } from "@/lib/audit-harness/rules";

function input() {
  return {
    documentKind: "REIMBURSEMENT", documentNumber: null, supplierName: null, supplierTaxId: null,
    issuedAt: "2026-07-06", totalAmount: "42.00", currency: "BRL", readConfidence: 0.95,
    markdown: "Controle sintético, duas despesas e comprovantes em páginas distintas.", warnings: [], requiredFieldChecks: [],
    itemCoverage: { status: "COMPLETE", declaredItemCount: 2, extractedItemCount: 2, firstLineNumber: 1,
      lastLineNumber: 2, missingLineNumbers: [], evidence: "Duas linhas preenchidas." },
    items: ["18.00", "24.00"].map((amount, index) => ({ lineNumber: index + 1, code: null,
      description: `Despesa sintética ${index + 1}`, documentRole: "LINE_ITEM", documentGroup: `source-${index + 1}`,
      countsTowardDocumentTotal: true, quantity: null, unitPrice: null, totalAmount: amount,
      sourceKind: "SHEET" as string | undefined, sourceDate: "2026-07-06", sourcePage: 1 as number | null,
      sourceText: `Linha ${index + 1}: 06/07/2026; total ${amount}` as string | null,
      evidenceObservations: [{ kind: "RECEIPT", amountScope: "ITEM_TOTAL", amount, date: index ? "2026-07-06" : "2026-07-05",
        page: index + 2, text: `Recibo ${amount}, ${index ? "06" : "05"}/07/2026`, label: null, documentGroup: `source-${index + 1}` }],
    })),
    pageCoverage: [1, 2, 3].map((page) => ({ page, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      requirementEvidence: null, sources: [{ kind: page === 1 ? "SHEET" : "RECEIPT", count: page === 1 ? 2 : 1 }] })),
  };
}

test("fonte primária tipada preserva cada linha da ficha sem pedir uma cópia ao modelo", () => {
  const original = input();
  const before = structuredClone(original);
  const result = parseInvoiceExtractionPayload(original);
  assert.ok(result.success);
  assert.deepEqual(original, before);
  assert.equal(result.data.items.length, 2);
  for (const item of result.data.items) {
    assert.equal(item.evidenceObservations.length, 2);
    assert.equal(item.evidenceObservations[0].kind, "SHEET");
    assert.equal(item.evidenceObservations[0].amount, item.totalAmount);
    assert.equal(item.evidenceObservations[0].text, item.sourceText);
    assert.equal(item.evidenceObservations[0].page, item.sourcePage);
  }
  assert.equal(getEvidenceCoverageLimitation(result.data, 3), null);
  assert.ok(evaluateUniversalRules({ invoice: result.data }).findings.some((finding) => finding.code === "EVIDENCE_DATE_MISMATCH_1"));
  const again = parseInvoiceExtractionPayload(result.data);
  assert.ok(again.success);
  assert.deepEqual(again.data, result.data);
});

test("tipo de documento, página ou palavra ficha não substituem origem explícita", () => {
  for (const kind of [undefined, "UNKNOWN", "FISCAL_LINE", "OTHER"]) {
    const value = input();
    value.items.forEach((item) => { item.sourceKind = kind; item.sourceText = "Ficha de controle 18,00"; });
    const result = parseInvoiceExtractionPayload(value);
    assert.ok(result.success);
    assert.equal(result.data.items[0].evidenceObservations.length, 1);
    assert.equal(getEvidenceCoverageLimitation(result.data, 3)?.diagnostic, "evidence-source-not-extracted");
  }
});

test("falta de página ou trecho impede materializar a fonte primária", () => {
  for (const missing of ["page", "text"]) {
    const value = input();
    if (missing === "page") value.items[0].sourcePage = null;
    else value.items[0].sourceText = null;
    const result = parseInvoiceExtractionPayload(value);
    assert.ok(result.success);
    assert.equal(result.data.items[0].evidenceObservations.length, 1);
    assert.equal(getEvidenceCoverageLimitation(result.data, 3)?.diagnostic, "evidence-source-not-extracted");
  }
});

test("fonte tipada não prova comprovante omitido nem completa páginas ou apoio desconhecidos", () => {
  const value = input();
  value.items[0].evidenceObservations = [];
  const result = parseInvoiceExtractionPayload(value);
  assert.ok(result.success);
  assert.equal(result.data.items[0].evidenceObservations.length, 1);
  assert.equal(getEvidenceCoverageLimitation(result.data, 3)?.diagnostic, "evidence-source-not-extracted");
  assert.equal(result.data.supportCoverage?.status, "UNKNOWN");
});

test("declarações conflitantes da mesma linha são limitação e não são fundidas", () => {
  const value = input();
  value.items[0].evidenceObservations.push({ ...value.items[0].evidenceObservations[0], kind: "SHEET",
    amount: "19.00", date: "2026-07-06", page: 1, text: "Total 19,00" });
  const result = parseInvoiceExtractionPayload(value);
  assert.ok(result.success);
  assert.equal(result.data.items[0].totalAmount, "18.00");
  assert.equal(result.data.items[0].evidenceObservations.length, 2);
  assert.equal(getEvidenceCoverageLimitation(result.data, 3)?.diagnostic, "evidence-primary-row-conflict");
});

test("data da fonte primária não é copiada do recibo nem consertada por palpite", () => {
  const value = input();
  value.items[0].sourceDate = "2026-02-31";
  const result = parseInvoiceExtractionPayload(value);
  assert.ok(result.success);
  assert.equal(result.data.items[0].sourceDate, null);
  assert.equal(result.data.items[0].evidenceObservations[0].date, null);
  assert.equal(result.data.items[0].evidenceObservations[1].date, "2026-07-05");
  assert.ok(result.data.warnings.includes(INVALID_DOCUMENT_DATE_WARNING));
});

test("transporte nativo remove apenas coordenadas não medidas e preserva proveniência e limites", () => {
  const before = JSON.stringify(INVOICE_EXTRACTION_JSON_SCHEMA);
  const schema = nativeExtractionSchema(INVOICE_EXTRACTION_JSON_SCHEMA);
  assert.doesNotMatch(JSON.stringify(schema), /boundingBox|sourceBoundingBox/);
  assert.equal(JSON.stringify(INVOICE_EXTRACTION_JSON_SCHEMA), before);
  const item = (schema.properties as { items: { items: { required: string[]; properties: Record<string, unknown> } } }).items.items;
  for (const name of ["sourceKind", "sourceDate", "sourcePage", "sourceText", "totalAmount", "evidenceObservations"]) {
    assert.ok(item.required.includes(name));
    assert.ok(item.properties[name]);
  }
  assert.match(JSON.stringify(schema), /pageCoverage|missingLineNumbers|maximum|minLength/);
});

test("uma declaração genérica de todos os campos não comprova conferência individual", () => {
  const value = input();
  const result = parseInvoiceExtractionPayload({ ...value,
    pageCoverage: value.pageCoverage.map((page) => page.page === 1 ? { ...page, requirementScope: "ALL_FIELDS",
      requirementEvidence: "O preenchimento de todos os campos é obrigatório." } : page),
    requiredFieldChecks: [{ field: "all_fields", label: "Todos os campos", requiredByDocument: true,
      requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: "O preenchimento de todos os campos é obrigatório.",
      present: true, page: 1, evidence: "Formulário conferido." }],
  });
  assert.ok(result.success);
  assert.equal(getEvidenceCoverageLimitation(result.data, 3)?.diagnostic, "evidence-required-instruction-not-applied");
  result.data.requiredFieldChecks = [{ ...result.data.requiredFieldChecks[0], field: "purpose", label: "Finalidade",
    present: false, evidence: "Campo Finalidade sem preenchimento." }];
  assert.equal(getEvidenceCoverageLimitation(result.data, 3), null);
});

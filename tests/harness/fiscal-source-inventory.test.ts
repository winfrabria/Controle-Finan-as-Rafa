import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";

function documentInput() {
  return { documentKind: "COMPOSITE", totalAmount: "33", readConfidence: 0.99,
    markdown: "Duas linhas fiscais, continuação em outra página e cobrança não quitada.",
    items: [1, 2].map(line => ({ lineNumber: line, description: "Produto sintético", documentRole: "LINE_ITEM",
      sourceKind: "FISCAL_LINE", sourceDate: null, sourcePage: line, sourceText: `Produto total ${line === 1 ? "15" : "18"},00`,
      totalAmount: line === 1 ? "15" : "18", countsTowardDocumentTotal: true, evidenceObservations: [] })),
    pageCoverage: [1, 2].map(page => ({ page, complete: true, fieldsReviewed: true,
      requirementScope: "NONE", requirementEvidence: null, sources: [{ kind: "FISCAL_LINE", count: 1 }] })),
  };
}

test("linha fiscal tem inventário próprio sem comprovante OTHER artificial", () => {
  const parsed = parseInvoiceExtractionPayload(documentInput());
  assert.ok(parsed.success);
  assert.equal(getEvidenceCoverageLimitation(parsed.data, 2), null);
  assert.equal(parsed.data.items.flatMap(item => item.evidenceObservations).length, 0);
});

test("inventário fiscal exige todas as linhas na página correta", () => {
  for (const change of ["count", "page", "quote", "kind"] as const) {
    const parsed = parseInvoiceExtractionPayload(documentInput());
    assert.ok(parsed.success);
    if (change === "count") parsed.data.pageCoverage![1].sources[0].count = 2;
    if (change === "page") parsed.data.items[1].sourcePage = 1;
    if (change === "quote") parsed.data.items[1].sourceText = null;
    if (change === "kind") parsed.data.items[1].sourceKind = "UNKNOWN";
    assert.ok(getEvidenceCoverageLimitation(parsed.data, 2), change);
  }
});

test("linhas fiscais presentes não podem desaparecer do inventário declarado", () => {
  const parsed = parseInvoiceExtractionPayload(documentInput());
  assert.ok(parsed.success);
  parsed.data.pageCoverage![1].sources = [];
  assert.equal(getEvidenceCoverageLimitation(parsed.data, 2)?.diagnostic, "evidence-source-fiscal-row-not-inventoried");
});

test("linha fiscal não preenche contexto OTHER ou pagamento omitido na mesma página", () => {
  for (const kind of ["OTHER", "PAYMENT"] as const) {
    const parsed = parseInvoiceExtractionPayload(documentInput());
    assert.ok(parsed.success);
    parsed.data.pageCoverage![1].sources.push({ kind, count: 1 });
    const limitation = getEvidenceCoverageLimitation(parsed.data, 2);
    assert.equal(limitation?.diagnostic, "evidence-source-not-extracted");
    assert.equal(limitation?.details.kind, kind);
  }
});

function chargeInput(sourceKind = "CHARGE", documentRole = "AGGREGATE_PAYMENT") {
  return { documentKind: "COMPOSITE", totalAmount: "33", readConfidence: 0.99,
    markdown: "Cobrança agregada sintética sem autenticação de pagamento.",
    items: [{ lineNumber: 1, description: "Boleto", sourceKind, documentRole,
      sourceDate: "2026-08-12", sourcePage: 1, sourceText: "Vencimento 12/08/2026. Valor 33,00. Sem quitação.",
      totalAmount: "33", countsTowardDocumentTotal: true }],
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      requirementEvidence: null, sources: [{ kind: "CHARGE", count: 1 }] }],
  };
}

test("cobrança agregada explicitamente tipada é preservada sem virar pagamento", () => {
  const parsed = parseInvoiceExtractionPayload(chargeInput());
  assert.ok(parsed.success);
  const observations = parsed.data.items[0].evidenceObservations;
  assert.equal(observations.length, 1);
  assert.equal(observations[0].kind, "CHARGE");
  assert.equal(observations[0].amountScope, "DOCUMENT_TOTAL");
  assert.equal(getEvidenceCoverageLimitation(parsed.data, 1), null);
  const again = parseInvoiceExtractionPayload(parsed.data);
  assert.ok(again.success);
  assert.deepEqual(again.data, parsed.data);
});

test("nome boleto não inventa uma fonte ou sua relação de agregação", () => {
  for (const [kind, role] of [["UNKNOWN", "AGGREGATE_PAYMENT"], ["CHARGE", "LINE_ITEM"], ["PAYMENT", "AGGREGATE_PAYMENT"]]) {
    const parsed = parseInvoiceExtractionPayload(chargeInput(kind, role));
    assert.ok(parsed.success);
    assert.equal(parsed.data.items[0].evidenceObservations.length, 0);
    assert.equal(getEvidenceCoverageLimitation(parsed.data, 1)?.diagnostic, "evidence-source-not-extracted");
  }
});

test("cobrança primária conflitante não é sobrescrita por observação nem confirmada", () => {
  const parsed = parseInvoiceExtractionPayload({ ...chargeInput(),
    items: [{ ...chargeInput().items[0], evidenceObservations: [{ kind: "CHARGE", amountScope: "DOCUMENT_TOTAL",
      amount: "34", date: "2026-08-12", page: 1, text: "12/08/2026. Total 34,00" }] }],
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.items[0].totalAmount, "33");
  assert.equal(parsed.data.items[0].evidenceObservations[0].amount, "34");
  assert.equal(getEvidenceCoverageLimitation(parsed.data, 1)?.diagnostic, "evidence-primary-row-conflict");
});

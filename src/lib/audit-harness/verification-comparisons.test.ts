import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { buildVerificationChecks, validateVerificationCoverage } from "./verification";
import { parseVerificationWirePayload } from "./verification-wire";

function fixture() {
  return invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", totalAmount: "46", readConfidence: 0.95,
    markdown: "Fontes sintéticas para conferência", warnings: [], items: [
      { lineNumber: 1, documentGroup: "synthetic", sourceKind: "FISCAL_LINE", sourcePage: 1,
        description: "Cabo A", sourceText: "Cabo A 10 x 4,60 = 46,00", quantity: "10", unitPrice: "4.60", totalAmount: "46" },
      { lineNumber: 2, documentGroup: "synthetic", sourceKind: "SHEET", sourcePage: 2,
        description: "Cabo B", sourceText: "Cabo B 10 x 4,60 = 46,00", quantity: "10", unitPrice: "4.60", totalAmount: "46" },
    ] });
}

function setup() {
  const invoice = fixture();
  const expectedChecks = buildVerificationChecks(invoice);
  const evidence = invoice.items.map(row => ({ page: row.sourcePage!, quote: row.sourceText!, source: row.sourceKind!, field: "produto e valor" }));
  const payload = { status: "PASS", summary: "Conferência sintética", findings: [], limitations: [],
    pageCoverage: { checkedPages: [1, 2], expectedPageCount: 2, missingPages: [], status: "COMPLETE" },
    checks: expectedChecks.filter(check => !check.sourcePair).map(check => ({ key: check.key, state: "VERIFIED",
      evidence, findingCode: null, limitationCode: null, comparison: null as unknown })) };
  return { invoice, expectedChecks, evidence, payload };
}

function coverage(value: ReturnType<typeof setup>) {
  const parsed = parseVerificationWirePayload(value.payload, value.expectedChecks);
  if (!parsed.success) throw parsed.error;
  return validateVerificationCoverage({ expectedChecks: value.expectedChecks, expectedPageCount: 2, response: parsed.data });
}

function addPair(value: ReturnType<typeof setup>, outcome = "CONSISTENT") {
  value.payload.checks.push({ key: "source-pair:1:2", state: "VERIFIED", evidence: value.evidence,
    findingCode: null, limitationCode: null,
    comparison: { outcome, basis: "Descrição e referência do original conferidas em ambas as fontes.", leftEvidenceIndex: 0, rightEvidenceIndex: 1 } });
}

test("PASS de todas as linhas e páginas não cobre a comparação entre fontes", () => {
  const result = coverage(setup());
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingKeys, ["source-pair:1:2"]);
});

test("par sem decisão ou com evidência de um lado só não obtém cobertura", () => {
  for (const comparison of [null,
    { outcome: "CONSISTENT", basis: "Teste", leftEvidenceIndex: 0, rightEvidenceIndex: 0 },
    { outcome: "CONSISTENT", basis: "Teste", leftEvidenceIndex: 1, rightEvidenceIndex: 0 },
    { outcome: "CONSISTENT", basis: "Teste", leftEvidenceIndex: 0, rightEvidenceIndex: 19 }]) {
    const value = setup(); addPair(value); value.payload.checks.at(-1)!.comparison = comparison;
    const result = coverage(value);
    assert.equal(result.complete, false);
    assert.deepEqual(result.invalidComparisonCheckKeys, ["source-pair:1:2"]);
  }
});

test("fontes compatíveis podem concluir sem achado; metadados do pedido não contaminam resposta", () => {
  const value = setup(); value.evidence[1].quote = value.evidence[0].quote;
  addPair(value);
  assert.equal(coverage(value).complete, true);
  const parsed = parseVerificationWirePayload(value.payload, value.expectedChecks);
  assert.ok(parsed.success);
  assert.equal("sourcePair" in parsed.data.checks.at(-1)!, false);
  assert.equal(parsed.data.checks.some(check => "amountReview" in check), false);
  assert.deepEqual(parsed.data.findings, []);
});

test("conflito ou relação indeterminada não podem se disfarçar de VERIFIED", () => {
  for (const outcome of ["CONFLICT", "UNRESOLVED"]) {
    const value = setup(); addPair(value, outcome);
    assert.equal(coverage(value).complete, false);
  }
});

test("limitação explícita do par não inventa irregularidade nem aprovação", () => {
  const value = setup(); addPair(value, "UNRESOLVED");
  Object.assign(value.payload.checks.at(-1)!, { state: "LIMITATION", limitationCode: "RELATIONSHIP_UNPROVEN" });
  value.payload.status = "LIMITED";
  const result = coverage(value);
  assert.equal(result.complete, false);
  assert.deepEqual(result.invalidComparisonCheckKeys, []);
  assert.deepEqual(value.payload.findings, []);
});

test("comparação não pode ser anexada a uma linha que não pede par", () => {
  const value = setup(); addPair(value);
  value.payload.checks[0].comparison = value.payload.checks.at(-1)!.comparison;
  assert.deepEqual(coverage(value).invalidComparisonCheckKeys, ["document:coverage"]);
});

test("total documental aceita conciliação opcional com duas evidências monetárias", () => {
  const value = setup(); addPair(value);
  value.payload.checks.find(check=>check.key === "document:total")!.comparison = value.payload.checks.at(-1)!.comparison;
  assert.equal(coverage(value).complete, true);
});

test("comparação de total sem dois lados ou com conflito sem achado continua inválida", () => {
  for (const scenario of ["index", "conflict", "no-money"]) {
    const value = setup(); addPair(value);
    const total = value.payload.checks.find(check=>check.key === "document:total")!;
    total.comparison = {outcome: scenario==="conflict"?"CONFLICT":"CONSISTENT", basis:"Conferência",leftEvidenceIndex:0,rightEvidenceIndex:scenario==="index"?0:1};
    if(scenario==="no-money") total.evidence = [{...value.evidence[0],field:"data",quote:"12/06/2026"},value.evidence[1]];
    assert(coverage(value).invalidComparisonCheckKeys.includes("document:total"));
  }
});

test("limite inclui comparações e impede cobertura integral quando algum check foi truncado", () => {
  const invoice = fixture();
  invoice.items = Array.from({ length: 150 }, (_, index) => invoice.items.map((row, side) => ({
    ...row, lineNumber: index * 2 + side + 1, documentGroup: `synthetic-${index}`,
  }))).flat();
  const expected = buildVerificationChecks(invoice);
  assert.equal(expected.length, 300);
  assert.equal(expected.at(-1)?.key, "document:item-check-overflow");
});

test("datas distintas nunca podem receber comparação CONSISTENT", () => {
  const value = setup();
  const pair = value.expectedChecks.find(check => check.key === "source-pair:1:2")!;
  pair.fieldReview = { field: "DATE", pages: [1, 2] };
  value.evidence[0] = { ...value.evidence[0], field: "data e valor", quote: "Data 19/05/2026; total R$ 46,00" };
  value.evidence[1] = { ...value.evidence[1], field: "data e valor", quote: "Data 18/05/2026; total R$ 46,00" };
  addPair(value, "CONSISTENT");
  assert.deepEqual(coverage(value).invalidComparisonCheckKeys, ["source-pair:1:2"]);

  const matching = setup();
  const matchingPair = matching.expectedChecks.find(check => check.key === "source-pair:1:2")!;
  matchingPair.fieldReview = { field: "DATE", pages: [1, 2] };
  matching.evidence[0] = { ...matching.evidence[0], field: "data e valor", quote: "Data 19/05/2026; total R$ 46,00" };
  matching.evidence[1] = { ...matching.evidence[1], field: "data e valor", quote: "Data 19/05/2026; total R$ 46,00" };
  addPair(matching, "CONSISTENT");
  assert.equal(coverage(matching).invalidComparisonCheckKeys.includes("source-pair:1:2"), false);

  const abbreviatedYear = setup();
  const abbreviatedPair = abbreviatedYear.expectedChecks.find(check => check.key === "source-pair:1:2")!;
  abbreviatedPair.fieldReview = { field: "DATE", pages: [1, 2] };
  abbreviatedYear.evidence[0] = { ...abbreviatedYear.evidence[0], field: "data e valor",
    quote: "Data 17/05/2026; total R$ 46,00" };
  abbreviatedYear.evidence[1] = { ...abbreviatedYear.evidence[1], field: "data e valor",
    quote: "Data 17/05/26; total R$ 46,00" };
  addPair(abbreviatedYear, "CONSISTENT");
  assert.equal(coverage(abbreviatedYear).invalidComparisonCheckKeys.includes("source-pair:1:2"), false);
});

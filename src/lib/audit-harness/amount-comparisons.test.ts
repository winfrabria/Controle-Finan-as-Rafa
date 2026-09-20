import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { buildAmountReviewPairs } from "./amount-review";
import { buildVerificationChecks, validateVerificationCoverage, type VerificationResponse } from "./verification";
import { parseVerificationWirePayload } from "./verification-wire";
import { individuallyConfirmedVerificationFindings } from "./individual-verification";

function fixture() {
  return invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", totalAmount: "86.00", readConfidence: 0.95,
    markdown: "Documento sintético", warnings: [], items: [
      { lineNumber: 7, description: "Componente sintético", documentGroup: "source-a", documentRole: "LINE_ITEM",
        sourceKind: "SALE", sourcePage: 1, sourceText: "Componente 80,00", totalAmount: "80.00",
        evidenceObservations: [{ kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", page: 1,
          amount: "86.00", text: "Débito R$ 86,00", documentGroup: "source-a" }] },
    ] });
}

function setup() {
  const invoice = fixture();
  const expectedChecks = buildVerificationChecks(invoice);
  const evidence = [
    { source: "SALE", page: 1, field: "valor", quote: "Componente 80,00; adicional 6,00; Total Geral 86,00" },
    { source: "PAYMENT", page: 1, field: "valor", quote: "Débito R$ 86,00" },
  ];
  const response: VerificationResponse = { status: "PASS", summary: "Resposta sintética", findings: [], limitations: [],
    pageCoverage: { status: "COMPLETE", expectedPageCount: 1, checkedPages: [1], missingPages: [] },
    checks: expectedChecks.map(({key, lineNumber, documentGroup, documentRole}) => ({ key, lineNumber,
      documentGroup, documentRole: documentRole ?? null, state: "VERIFIED", evidence: structuredClone(evidence),
      findingCode: null, limitationCode: null, comparison: null })),
  };
  const pair = response.checks.find(check => check.key === "line:7")!;
  return { invoice, expectedChecks, response, pair };
}

function coverage(value: ReturnType<typeof setup>) {
  return validateVerificationCoverage({ expectedChecks: value.expectedChecks, expectedPageCount: 1, response: value.response });
}

function decide(value: ReturnType<typeof setup>, outcome: "CONSISTENT" | "CONFLICT" | "UNRELATED" | "UNRESOLVED" = "CONSISTENT") {
  value.pair.comparison = { outcome, leftEvidenceIndex: 0, rightEvidenceIndex: 1,
    basis: "O total da venda inclui componente 80,00 + adicional 6,00 = 86,00, pago no débito." };
}

test("leitura de item e pagamento não conclui conciliação nem promove componente a total", () => {
  const value = setup();
  assert.deepEqual(value.expectedChecks.at(-1)?.amountPair, { sources: [{ kind: "SALE", page: 1 }, { kind: "PAYMENT", page: 1 }] });
  assert.equal(JSON.stringify(value.expectedChecks).includes("80.00"), false);
  assert.equal(coverage(value).complete, false);
  assert.deepEqual(coverage(value).invalidComparisonCheckKeys, ["line:7"]);
  assert.deepEqual(value.response.findings, []);
  assert.equal(value.invoice.items[0].totalAmount, "80.00");
});

test("composição conciliada permite resultado sem achados apesar de valores extraídos diferentes", () => {
  const value = setup(); decide(value);
  assert.equal(coverage(value).complete, true);
  assert.deepEqual(value.response.findings, []);
  const wire = { ...value.response, checks: value.response.checks.map(({key, state, evidence, findingCode, limitationCode, comparison}) =>
    ({key, state, evidence, findingCode, limitationCode, comparison})) };
  assert.equal(parseVerificationWirePayload(wire, value.expectedChecks).success, true);
});

test("evidências na mesma página não permitem trocar venda por pagamento ou citar só datas", () => {
  for (const mutate of [
    (value: ReturnType<typeof setup>) => { value.pair.comparison!.rightEvidenceIndex = 0; },
    (value: ReturnType<typeof setup>) => { value.pair.comparison!.rightEvidenceIndex = 19; },
    (value: ReturnType<typeof setup>) => { value.pair.evidence[1].source = "SALE"; },
    (value: ReturnType<typeof setup>) => { value.pair.evidence[1].page = 2; },
    (value: ReturnType<typeof setup>) => { value.pair.evidence[1].field = "data"; value.pair.evidence[1].quote = "12/06/2026"; },
  ]) {
    const value = setup(); decide(value); mutate(value);
    assert.equal(coverage(value).complete, false);
    assert.deepEqual(coverage(value).invalidComparisonCheckKeys, [value.pair.key]);
  }
});

test("operação distinta precisa de decisão; inconclusão não se transforma em aprovação ou suspeita", () => {
  const value = setup(); decide(value, "UNRELATED");
  value.pair.comparison!.basis = "Venda do pedido 301 e pagamento do pedido 502, identificadores citados no original.";
  value.pair.evidence[0].quote += " Pedido 301"; value.pair.evidence[1].quote += " Pedido 502";
  assert.equal(coverage(value).complete, true);
  decide(value, "UNRESOLVED");
  assert.equal(coverage(value).complete, false);
  value.pair.state = "LIMITATION"; value.pair.limitationCode = "RELATIONSHIP_UNPROVEN";
  value.pair.evidence = []; value.pair.comparison!.leftEvidenceIndex = null; value.pair.comparison!.rightEvidenceIndex = null;
  assert.deepEqual(coverage(value).invalidComparisonCheckKeys, []);
  assert.deepEqual(coverage(value).invalidEvidenceCheckKeys, []);
  assert.equal(coverage(value).complete, false);
  assert.deepEqual(value.response.findings, []);
});

test("conflito exige achado vinculado aos valores e fontes do par, não a um problema distinto", () => {
  const value = setup(); decide(value, "CONFLICT");
  value.pair.evidence[0].quote = "Total Geral 89,00";
  value.pair.comparison!.basis = "Total da venda 89,00 e débito 86,00 sem ajuste documentado.";
  value.pair.state = "FINDING"; value.pair.findingCode = "PAYMENT_CONFLICT";
  assert.equal(coverage(value).complete, false);
  value.response.status = "FINDINGS";
  value.response.findings = [{ code: "PAYMENT_CONFLICT", confirmsInitialFindingCode: null, source: "AI_VERIFICATION",
    category: "AMOUNTS", severity: "WARNING", confidence: 0.9, title: "Valores não conciliados",
    description: "Venda e pagamento têm valores diferentes.", justification: "Fontes originais sem ajuste documentado.",
    references: ["Documento original · página 1"], actualValue: "89,00 e 86,00", expectedValue: null,
    comparisonMode: "CONFLICT", referenceBasis: null, noteItemLineNumber: 7,
    evidence: { field: "valor", page: 1, lineNumber: 7, source: "DOCUMENTO", summary: "Conflito monetário", claimScope: "DOCUMENT_CONTENT",
      observations: [ { kind: "SALE", label: "Venda", page: 1, text: "Total Geral 89,00", value: "89.00" },
        { kind: "PAYMENT", label: "Débito", page: 1, text: "Débito R$ 86,00", value: "86.00" } ] },
  }];
  assert.equal(coverage(value).complete, true);
  const individualInput = { expectedChecks: value.expectedChecks, expectedPageCount: 1, initialFindings: [], response: value.response };
  assert.equal(individuallyConfirmedVerificationFindings(individualInput, { requireIndividualTrace: true }).length, 1);
  for (const scenario of ["scope", "reference", "different-line", "untraced-quote", "reversed-values", "ambiguous-code"]) {
    const changed = structuredClone(individualInput);
    const finding = changed.response.findings[0];
    if (scenario === "scope") finding.evidence.claimScope = "WORK_AUTHORIZATION";
    if (scenario === "reference") finding.expectedValue = "89.00";
    if (scenario === "different-line") finding.noteItemLineNumber = 8;
    if (scenario === "untraced-quote") changed.response.checks.at(-1)!.evidence[1].quote = "Débito aprovado";
    if (scenario === "reversed-values") {
      finding.evidence.observations![0].value = "86.00"; finding.evidence.observations![0].text = "Total Geral 86,00";
      finding.evidence.observations![1].value = "89.00"; finding.evidence.observations![1].text = "Débito R$ 89,00";
    }
    if (scenario === "ambiguous-code") changed.response.findings.push(structuredClone(finding));
    assert.equal(individuallyConfirmedVerificationFindings(changed, { requireIndividualTrace: true }).length, 0, scenario);
  }
  value.response.checks[0].state = "LIMITATION"; value.response.checks[0].limitationCode = "UNREADABLE_CONTEXT";
  assert.equal(coverage(value).complete, false);
  assert.equal(individuallyConfirmedVerificationFindings(individualInput).length, 1, "An unrelated coverage gap does not erase a fully traced conflict.");
  value.response.findings[0].evidence.observations![1].kind = "RECEIPT";
  // Same value but another source must not borrow the pair's confirmation.
  assert.equal(coverage(value).complete, false);
  assert.equal(individuallyConfirmedVerificationFindings(individualInput).length, 0);
});

test("três fontes geram três decisões, inclusive a terceira quando as duas primeiras concordam", () => {
  const invoice = fixture();
  invoice.items[0].evidenceObservations.push({ kind: "RECEIPT", page: 2, amount: "80.00", date: null,
    amountScope: "DOCUMENT_TOTAL", documentGroup: "source-a", label: null, text: "Recibo 80,00" });
  const before = structuredClone(invoice);
  assert.deepEqual(buildAmountReviewPairs(invoice).map(pair => pair.key),
    ["amount-pair:7:1:2", "amount-pair:7:1:3", "amount-pair:7:2:3"]);
  const checks = buildVerificationChecks(invoice);
  assert.deepEqual(checks.filter(check => check.amountPair).map(check => check.key),
    ["line:7", "amount-pair:7:1:3", "amount-pair:7:2:3"]);
  assert.equal(checks.length, 5);
  assert.deepEqual(invoice, before);
});

test("limite de checks considera os pares sem declarar cobertura integral do que foi cortado", () => {
  const invoice = fixture();
  invoice.items = Array.from({length: 310}, (_, index) => ({ ...invoice.items[0], lineNumber: index + 1 }));
  const checks = buildVerificationChecks(invoice);
  assert.equal(checks.length, 300);
  assert.equal(checks.at(-1)?.key, "document:item-check-overflow");
});

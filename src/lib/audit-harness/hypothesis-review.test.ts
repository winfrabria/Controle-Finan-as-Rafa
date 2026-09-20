import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { aiDiscoveryFindingSchema } from "./contracts";
import { buildVerificationChecks, validateVerificationCoverage, verificationFindingSchema, type VerificationResponse } from "./verification";

function setup() {
  const invoice = invoiceExtractionSchema.parse({ markdown: "Documentos sintéticos", readConfidence: 0.9, items: [] });
  const initial = aiDiscoveryFindingSchema.parse({ code: "AMOUNT_CONFLICT", source: "AI_DISCOVERY", category: "AMOUNT",
    title: "Valores diferentes", description: "Duas fontes mostram totais diferentes.", severity: "WARNING", confidence: 0.9,
    justification: "Conferir fontes originais.", references: ["Página 1", "Página 2"], comparisonMode: "CONFLICT",
    expectedValue: null, actualValue: "R$ 83,00; R$ 85,00", referenceBasis: null, noteItemLineNumber: null,
    evidence: { field: "amount", page: 1, lineNumber: null, source: "Originais", summary: "Totais distintos",
      claimScope: "DOCUMENT_CONTENT", observations: [
        { kind: "RECEIPT", page: 1, label: "Recibo", text: "Total R$ 83,00", value: "83.00" },
        { kind: "PAYMENT", page: 2, label: "Pagamento", text: "Pago R$ 85,00", value: "85.00" },
      ] } });
  const initialFindings = [initial];
  const expectedChecks = buildVerificationChecks(invoice, initialFindings);
  const evidence = initial.evidence.observations!.map(source => ({ field: "amount", page: source.page, source: source.label, quote: source.text }));
  const response: VerificationResponse = { status: "PASS", findings: [], limitations: [], summary: "Teste sintético",
    pageCoverage: { status: "COMPLETE", checkedPages: [1, 2], missingPages: [], expectedPageCount: 2 },
    checks: expectedChecks.map(check => ({ key: check.key, lineNumber: check.lineNumber, documentGroup: check.documentGroup,
      documentRole: check.documentRole ?? null, state: "VERIFIED", findingCode: null, limitationCode: null, evidence,
      comparison: check.hypothesisReview ? { outcome: "CONSISTENT", basis: "Desconto explícito de R$ 2,00 na fonte.", leftEvidenceIndex: 0, rightEvidenceIndex: 1 } : null })) };
  return { invoice, initialFindings, expectedChecks, expectedPageCount: 2, response };
}

test("PASS por linha não pode omitir uma hipótese de conflito", () => {
  const value = setup(); value.response.checks = value.response.checks.filter(check => check.key !== "hypothesis:1");
  assert.deepEqual(validateVerificationCoverage(value).missingKeys, ["hypothesis:1"]);
  assert.equal(validateVerificationCoverage(value).complete, false);
});

test("hipóteses com mesmo código mantêm decisões independentes", () => {
  const value = setup();
  const second = structuredClone(value.initialFindings[0]); second.evidence.observations![1].value = "90.00";
  const checks = buildVerificationChecks(value.invoice, [...value.initialFindings, second]);
  assert.deepEqual(checks.filter(check => check.hypothesisReview).map(check => [check.key, check.hypothesisReview!.initialFindingIndex]),
    [["hypothesis:1", 0], ["hypothesis:2", 1]]);
});

test("rejeição fundamentada de uma hipótese não força achado", () => {
  const value = setup();
  value.response.checks.at(-1)!.evidence[1].quote += "; desconto explícito R$ 2,00";
  assert.equal(validateVerificationCoverage(value).complete, true);
  assert.equal(value.response.findings.length, 0);
  value.response.checks.at(-1)!.comparison!.outcome = "UNRELATED";
  value.response.checks.at(-1)!.comparison!.basis = "Identificadores de operações distintas no documento.";
  assert.equal(validateVerificationCoverage(value).complete, true);
});

test("decisão ausente, unilateral ou sem a hipótese de origem não obtém cobertura", () => {
  for (const mode of ["no-decision", "same-source", "wrong-page", "missing-initial"]) {
    const value = setup(); const check = value.response.checks.at(-1)!;
    if (mode === "no-decision") check.comparison = null;
    if (mode === "same-source") check.comparison!.rightEvidenceIndex = 0;
    if (mode === "wrong-page") check.evidence = [check.evidence[0], { ...check.evidence[1], page: 1 }];
    if (mode === "missing-initial") value.initialFindings = [];
    assert.deepEqual(validateVerificationCoverage(value).invalidComparisonCheckKeys, ["hypothesis:1"], mode);
  }
});

test("conflito exige confirmação da mesma alegação, não outro conflito de mesmo código", () => {
  const value = setup(); const check = value.response.checks.at(-1)!;
  value.response.status = "FINDINGS"; check.state = "FINDING"; check.findingCode = "AMOUNT_CONFLICT";
  check.comparison!.outcome = "CONFLICT";
  const finding = verificationFindingSchema.parse({ ...value.initialFindings[0], source: "AI_VERIFICATION", confirmsInitialFindingCode: "AMOUNT_CONFLICT" });
  value.response.findings = [finding];
  assert.equal(validateVerificationCoverage(value).complete, true);
  finding.evidence.observations![1].value = "90.00"; finding.evidence.observations![1].text = "Pago R$ 90,00";
  assert.deepEqual(validateVerificationCoverage(value).invalidComparisonCheckKeys, ["hypothesis:1"]);
});

test("indeterminação mantém limitação sem fabricar irregularidade", () => {
  const value = setup(); const check = value.response.checks.at(-1)!;
  check.comparison!.outcome = "UNRESOLVED"; check.state = "LIMITATION"; check.limitationCode = "RELATIONSHIP_UNRESOLVED";
  value.response.status = "LIMITED";
  assert.deepEqual(validateVerificationCoverage(value).invalidComparisonCheckKeys, []);
  assert.equal(validateVerificationCoverage(value).complete, false);
  assert.equal(value.response.findings.length, 0);
});

test("hipótese com três fontes exige evidência também da terceira página", () => {
  const value = setup();
  value.initialFindings[0].evidence.observations!.push({ kind: "SHEET", label: "Ficha", page: 3, text: "R$ 83,00", value: "83.00" });
  value.expectedChecks = buildVerificationChecks(value.invoice, value.initialFindings);
  assert.deepEqual(validateVerificationCoverage(value).invalidComparisonCheckKeys, ["hypothesis:1"]);
});

for (const pair of [[1, 2], [2, 0], [0, 1], [1, 1]]) {
test(`três fontes: par ${pair.join("/")} é validado pelo conteúdo, não pela posição inicial`, () => {
  const value = setup();
  const initial = value.initialFindings[0];
  initial.evidence.observations!.splice(1, 0, { kind: "SHEET", page: 3, label: "Ficha", text: "Total R$ 83,00", value: "83.00" });
  value.expectedChecks = buildVerificationChecks(value.invoice, value.initialFindings);
  value.expectedPageCount = 3;
  value.response.pageCoverage = { status: "COMPLETE", expectedPageCount: 3, checkedPages: [1, 2, 3], missingPages: [] };
  value.response.status = "FINDINGS";
  const check = value.response.checks.at(-1)!;
  check.state = "FINDING"; check.findingCode = initial.code;
  check.evidence = initial.evidence.observations!.map(source => ({ page: source.page, field: "amount", source: source.label, quote: source.text }));
  check.comparison = { outcome: "CONFLICT", basis: "Uma terceira fonte difere das outras duas.", leftEvidenceIndex: pair[0], rightEvidenceIndex: pair[1] };
  value.response.findings = [verificationFindingSchema.parse({ ...initial, source: "AI_VERIFICATION", confirmsInitialFindingCode: initial.code })];
  const valid = pair.includes(2);
  assert.equal(validateVerificationCoverage(value).complete, valid);
  assert.deepEqual(validateVerificationCoverage(value).invalidComparisonCheckKeys, valid ? [] : ["hypothesis:1"]);
});
}

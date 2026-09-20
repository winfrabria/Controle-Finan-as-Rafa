import assert from "node:assert/strict";
import test from "node:test";
import { aiDiscoveryFindingSchema } from "./contracts";
import { individuallyConfirmedVerificationFindings } from "./individual-verification";
import { buildVerificationChecks, validateVerificationCoverage, verificationFindingSchema,
  verificationResponseSchema } from "./verification";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";

function fixture() {
  const invoice = invoiceExtractionSchema.parse({ markdown: "Synthetic three-page document", readConfidence: 0.9, items: [] });
  const initial = aiDiscoveryFindingSchema.parse({ code: "DOCUMENT_AMOUNT_CONFLICT", category: "AMOUNT", source: "AI_DISCOVERY",
    confidence: 0.9, severity: "WARNING", title: "Valores conflitantes", description: "Fontes distintas indicam totais diferentes.",
    justification: "Conferir os registros originais.", references: ["Página 1", "Página 2"], comparisonMode: "CONFLICT",
    referenceBasis: null, expectedValue: null, actualValue: "R$ 83,00 e R$ 85,00", noteItemLineNumber: null,
    evidence: { field: "amount", page: 1, lineNumber: null, source: "Originais", summary: "Dois registros", claimScope: "DOCUMENT_CONTENT",
      observations: [{ kind: "RECEIPT", label: "Recibo", page: 1, text: "Total R$ 83,00", value: "83.00" },
        { kind: "PAYMENT", label: "Pagamento", page: 2, text: "Pago R$ 85,00", value: "85.00" }] } });
  const initialFindings = [initial]; const expectedChecks = buildVerificationChecks(invoice, initialFindings);
  const response = verificationResponseSchema.parse({ status: "LIMITED", summary: "A terceira página não pôde ser conferida.",
    limitations: ["Página 3 ilegível"], pageCoverage: { status: "INCOMPLETE", expectedPageCount: 3, checkedPages: [1, 2], missingPages: [3] },
    findings: [verificationFindingSchema.parse({ ...initial, source: "AI_VERIFICATION", confirmsInitialFindingCode: initial.code })],
    checks: expectedChecks.map(check => ({ key: check.key, documentGroup: check.documentGroup, documentRole: check.documentRole,
      lineNumber: check.lineNumber, state: check.hypothesisReview ? "FINDING" : "LIMITATION", findingCode: check.hypothesisReview ? initial.code : null,
      limitationCode: check.hypothesisReview ? null : "UNREADABLE_PAGE", evidence: initial.evidence.observations!.map(source => ({
        field: "amount", page: source.page, source: source.label, quote: source.text })),
      comparison: check.hypothesisReview ? { outcome: "CONFLICT", basis: "O recibo e o pagamento da operação mostram totais distintos, sem ajuste explícito.",
        leftEvidenceIndex: 0, rightEvidenceIndex: 1 } : null })) });
  return { expectedChecks, expectedPageCount: 3 as number | null, initialFindings, response };
}

test("conflito confirmado mantém-se visível sem transformar cobertura parcial em aprovação", () => {
  const input = fixture();
  assert.equal(validateVerificationCoverage(input).complete, false);
  assert.deepEqual(individuallyConfirmedVerificationFindings(input).map(finding => finding.code), [input.initialFindings[0].code]);
  assert.equal(validateVerificationCoverage(input).complete, false);
  assert.equal(input.response.status, "LIMITED");
});

for (const scenario of ["missing-hypothesis", "duplicate-key", "same-source", "wrong-page", "wrong-value", "unquoted-value",
  "unrelated", "unknown-page-count", "changed-scope", "reference", "unknown-code", "untraced-check-values"] as const) {
  test(`cobertura parcial não aceita achado com ${scenario}`, () => {
    const input = fixture(); const check = input.response.checks.at(-1)!; const finding = input.response.findings[0];
    if (scenario === "missing-hypothesis") input.response.checks.pop();
    if (scenario === "duplicate-key") input.response.checks.push(structuredClone(check));
    if (scenario === "same-source") check.comparison!.rightEvidenceIndex = 0;
    if (scenario === "wrong-page") finding.evidence.observations![1].page = 4;
    if (scenario === "wrong-value") {
      finding.evidence.observations![1].value = "86.00"; finding.evidence.observations![1].text = "Pago R$ 86,00";
    }
    if (scenario === "unquoted-value") finding.evidence.observations![1].text = "Comprovante sem valor legível";
    if (scenario === "unrelated") { check.comparison!.outcome = "UNRELATED"; check.state = "VERIFIED"; }
    if (scenario === "unknown-page-count") input.expectedPageCount = null;
    if (scenario === "changed-scope") finding.evidence.claimScope = "WORK_AUTHORIZATION";
    if (scenario === "reference") finding.comparisonMode = "REFERENCE";
    if (scenario === "unknown-code") check.findingCode = "DIFFERENT_CODE";
    if (scenario === "untraced-check-values") check.evidence[1].quote = "Pagamento aprovado, valor não transcrito";
    assert.equal(individuallyConfirmedVerificationFindings(input).length, 0);
  });
}

test("erro em check não relacionado não é transferido ao conflito localizado", () => {
  const input = fixture(); input.response.checks[0].evidence[0].page = 100;
  assert.deepEqual(validateVerificationCoverage(input).invalidEvidenceCheckKeys, ["document:coverage"]);
  assert.equal(individuallyConfirmedVerificationFindings(input).length, 1);
});

test("hipótese adicional sem confirmação não herda a decisão da primeira", () => {
  const input = fixture(); const second = structuredClone(input.initialFindings[0]); second.code = "OTHER_CONFLICT";
  input.initialFindings.push(second);
  input.expectedChecks.push({ ...input.expectedChecks.at(-1)!, key: "hypothesis:2", hypothesisReview: {
    initialFindingIndex: 1, code: second.code, pages: [1, 2] } });
  input.response.findings.push(verificationFindingSchema.parse({ ...second, source: "AI_VERIFICATION", confirmsInitialFindingCode: second.code }));
  assert.deepEqual(individuallyConfirmedVerificationFindings(input).map(finding => finding.code), [input.initialFindings[0].code]);
});

test("quarentena nunca promove autorização mesmo quando o inventário de páginas declara completude", () => {
  const input = fixture();
  input.expectedPageCount = 2; input.response.pageCoverage = { status: "COMPLETE", expectedPageCount: 2, checkedPages: [1, 2], missingPages: [] };
  input.response.status = "FINDINGS"; input.response.limitations = [];
  for (const check of input.response.checks.filter(check => !check.key.startsWith("hypothesis:"))) {
    check.state = "VERIFIED"; check.limitationCode = null;
  }
  input.initialFindings[0].evidence.claimScope = "WORK_AUTHORIZATION";
  input.response.findings[0].evidence.claimScope = "WORK_AUTHORIZATION";
  assert.equal(validateVerificationCoverage(input).complete, true);
  assert.equal(individuallyConfirmedVerificationFindings(input, { requireIndividualTrace: true }).length, 0);
});

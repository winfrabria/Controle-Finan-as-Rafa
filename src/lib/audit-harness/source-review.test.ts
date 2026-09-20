import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessFinding, HarnessInvoice } from "./contracts";
import { evaluateHarness } from "./engine";
import { decideClassification, isSupportedFinding } from "./decision-matrix";
import { markFindingsForSourceReview, requiresSourceReview } from "./source-review";

const finding: HarnessFinding = {
  code: "EVIDENCE_AMOUNT_MISMATCH_1", title: "Valores divergentes", description: "Comparação extraída.",
  category: "AMOUNTS", severity: "WARNING", source: "UNIVERSAL_RULE", confidence: 0.99,
  justification: "Comparação entre ficha e recibo.", references: [],
  evidence: { field: "valor", page: 3, summary: "Ficha 30,00; recibo 35,00" },
  expectedValue: null, actualValue: ["30.00", "35.00"], noteItemLineNumber: 1,
};

test("leitura incompleta preserva apontamento provisório sem tratá-lo como suspeita comprovada", () => {
  const findings = markFindingsForSourceReview([finding], true);
  assert.equal(requiresSourceReview(findings[0].evidence), true);
  assert.equal(requiresSourceReview(finding.evidence), false);
  assert.equal(isSupportedFinding(findings[0]), false);
  assert.deepEqual(findings[0].actualValue, finding.actualValue);
  assert.equal(decideClassification({ findings, readFailed: false, aiCoverage: false,
    deterministicCoverage: true, informationInsufficient: true }), "INFORMATION_INSUFFICIENT");
});

test("cobertura de suporte parcial não rebaixa sozinha uma comparação cuja leitura foi conferida", () => {
  assert.strictEqual(markFindingsForSourceReview([finding], false)[0], finding);
  assert.equal(isSupportedFinding(finding), true);
});

test("somente hash original e verificação independente dispensam a revisão da fonte incompleta", () => {
  const hash = { ...finding, code: "DUPLICATE_ATTACHMENT", evidence: { matchBasis: "FILE_SHA256" } };
  const fiscal = { ...finding, code: "POSSIBLE_DUPLICATE" };
  const verified = { ...finding, source: "AI_VERIFICATION" as const };
  const marked = markFindingsForSourceReview([hash, fiscal, verified], true);
  assert.deepEqual(marked.map((entry) => requiresSourceReview(entry.evidence)), [false, true, false]);
  assert.deepEqual(marked.map(isSupportedFinding), [true, false, true]);
});

test("engine com limitação explícita não converte campos vazios em certeza nem perde o apontamento", () => {
  const invoice: HarnessInvoice = {
    documentKind: "REIMBURSEMENT", documentNumber: null, supplierName: "Pessoa sintética", supplierTaxId: null,
    issuedAt: "2026-07-01", totalAmount: "30.00", readConfidence: 0.9, warnings: [], markdown: "Ficha sintética.",
    items: [{ lineNumber: 1, description: "Refeição sintética", totalAmount: "30.00", quantity: "1", unitPrice: "30.00" }],
    requiredFieldChecks: [{ field: "motivo", label: "Motivo", requiredByDocument: true,
      requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: "Preenchimento obrigatório.",
      present: false, page: 1, evidence: "Motivo: [campo vazio]" }],
  };
  const result = evaluateHarness({ invoice, extractionLimited: true });
  assert.equal(result.classification, "INFORMATION_INSUFFICIENT");
  assert.equal(result.findings.length, 1);
  assert.equal(requiresSourceReview(result.findings[0].evidence), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerificationChecks,
  canRetainSuspiciousAfterVerificationFailure,
  evaluateHarness,
  resolveAuditAssurance,
  selectVerification,
  validateVerificationCoverage,
  verificationResponseSchema,
  type HarnessFinding,
  type HarnessInvoice,
  type VerificationResponse,
} from "./index";

function invoice(overrides: Partial<HarnessInvoice> = {}): HarnessInvoice {
  return {
    documentKind: "FISCAL_INVOICE",
    documentNumber: "DOC",
    issuedAt: "2026-08-25",
    itemCoverage: {
      declaredItemCount: 1,
      evidence: "Tabela completa",
      extractedItemCount: 1,
      firstLineNumber: 1,
      lastLineNumber: 1,
      missingLineNumbers: [],
      status: "COMPLETE",
    },
    items: [{
      countsTowardDocumentTotal: true,
      description: "Item",
      documentGroup: "grupo-1",
      documentRole: "LINE_ITEM",
      evidenceObservations: [],
      lineNumber: 1,
      quantity: "1",
      totalAmount: "100.00",
      unitPrice: "100.00",
    }],
    markdown: "Documento financeiro com item e total legíveis para auditoria.",
    readConfidence: 0.95,
    supplierName: "Fornecedor",
    supplierTaxId: "00000000000000",
    totalAmount: "100.00",
    warnings: [],
    ...overrides,
  };
}

function aiFinding(): HarnessFinding {
  return {
    actualValue: "110.00",
    category: "AMOUNT",
    code: "AI_AMOUNT_MISMATCH",
    confidence: 0.9,
    description: "Dois valores ligados à mesma transação divergem.",
    evidence: {
      field: "total",
      lineNumber: 1,
      page: 1,
      source: "Página 1",
      summary: "Total impresso de R$ 110,00.",
    },
    expectedValue: "100.00",
    justification: "Os dois totais estão legíveis na mesma transação.",
    noteItemLineNumber: 1,
    references: ["Página 1"],
    severity: "WARNING",
    source: "AI_DISCOVERY",
    title: "Divergência de valor",
  };
}

function response(expectedChecks: ReturnType<typeof buildVerificationChecks>): VerificationResponse {
  return {
    checks: expectedChecks.map((check) => ({
      ...check,
      documentRole: check.documentRole ?? null,
      evidence: [],
      findingCode: null,
      limitationCode: null,
      state: "VERIFIED",
    })),
    findings: [],
    limitations: [],
    pageCoverage: {
      checkedPages: [1, 2],
      expectedPageCount: 2,
      missingPages: [],
      status: "COMPLETE",
    },
    status: "PASS",
    summary: "Todas as páginas e linhas foram conferidas.",
  };
}

test("seleciona verificação por sinais genéricos e nunca por caso real", () => {
  const selected = selectVerification({
    aiCoverage: false,
    baseClassification: "SUSPICIOUS",
    baseFindings: [aiFinding()],
    extractionAttempts: 2,
    invoice: invoice({
      documentKind: "COMPOSITE",
      readConfidence: 0.7,
      totalAmount: "50000.00",
      warnings: ["a", "b", "c"],
    }),
    pageCount: 8,
  });
  assert.equal(selected.required, true);
  assert.deepEqual(
    new Set(selected.reasons),
    new Set([
      "COMPOSITE_DOCUMENT",
      "LONG_DOCUMENT",
      "LOW_READABLE_CONFIDENCE",
      "MULTIPLE_EXTRACTION_WARNINGS",
      "RECOVERED_EXTRACTION",
      "HIGH_VALUE",
      "AI_ONLY_SUSPICION",
      "INSUFFICIENT_AUDIT_COVERAGE",
    ]),
  );
});

test("READ_FAILED nunca abre chamada seletiva", () => {
  assert.deepEqual(
    selectVerification({
      aiCoverage: false,
      baseClassification: "READ_FAILED",
      baseFindings: [],
      invoice: invoice({ documentKind: "COMPOSITE" }),
      pageCount: 20,
    }),
    { required: false, reasons: [] },
  );
});

test("cobertura do verificador exige todas as chaves e páginas", () => {
  const checks = buildVerificationChecks(invoice());
  const complete = validateVerificationCoverage({
    expectedChecks: checks,
    expectedPageCount: 2,
    response: response(checks),
  });
  assert.equal(complete.complete, true);

  const incompleteResponse = response(checks);
  incompleteResponse.checks.pop();
  incompleteResponse.pageCoverage.checkedPages = [1];
  const incomplete = validateVerificationCoverage({
    expectedChecks: checks,
    expectedPageCount: 2,
    response: incompleteResponse,
  });
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.missingKeys.length, 1);
  assert.deepEqual(incomplete.missingPages, [2]);
});

test("mais de 297 linhas nunca recebe cobertura completa artificial", () => {
  const largeInvoice = invoice({
    items: Array.from({ length: 350 }, (_, index) => ({
      countsTowardDocumentTotal: true,
      description: `Item ${index + 1}`,
      documentGroup: "grupo",
      documentRole: "LINE_ITEM" as const,
      evidenceObservations: [],
      lineNumber: index + 1,
      quantity: "1",
      totalAmount: "1.00",
      unitPrice: "1.00",
    })),
  });
  const checks = buildVerificationChecks(largeInvoice);
  assert.equal(checks.length, 300);
  assert.equal(checks.at(-1)?.key, "document:item-check-overflow");
  assert.equal(
    validateVerificationCoverage({
      expectedChecks: checks,
      expectedPageCount: 2,
      response: response(checks),
    }).complete,
    false,
  );
});

test("achado do verificador exige página, referência e evidência concreta", () => {
  const checks = buildVerificationChecks(invoice());
  const value = response(checks) as unknown as Record<string, unknown>;
  value.findings = [{
    actualValue: "110.00",
    category: "AMOUNT",
    code: "VERIFIER_AMOUNT",
    confidence: 0.9,
    description: "Divergência",
    evidence: {
      field: "total",
      lineNumber: 1,
      page: null,
      source: "Documento",
      summary: "Valor divergente",
    },
    expectedValue: "100.00",
    justification: "Valores divergem",
    noteItemLineNumber: 1,
    references: [],
    severity: "WARNING",
    source: "AI_VERIFICATION",
    title: "Divergência",
  }];
  assert.equal(verificationResponseSchema.safeParse(value).success, false);
});

test("achado sem check correspondente não pode certificar cobertura", () => {
  const checks = buildVerificationChecks(invoice());
  const value = response(checks);
  value.status = "FINDINGS";
  value.findings = [{
    ...aiFinding(),
    actualValue: "110.00",
    evidence: {
      field: "total",
      lineNumber: 1,
      page: 1,
      source: "Página 1",
      summary: "Total impresso de R$ 110,00.",
    },
    expectedValue: "100.00",
    source: "AI_VERIFICATION",
  }];
  const coverage = validateVerificationCoverage({
    expectedChecks: checks,
    expectedPageCount: 2,
    response: value,
  });
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.unlinkedFindingCodes, ["AI_AMOUNT_MISMATCH"]);
});

test("faixa de garantia não expõe score e sinaliza risco não verificado", () => {
  const selection = { required: true, reasons: ["LONG_DOCUMENT"] };
  assert.equal(
    resolveAuditAssurance({
      aiCoverage: true,
      classification: "OK",
      mode: "off",
      selection,
      verificationStatus: "NOT_RUN",
    }).band,
    "LIMITED",
  );
  assert.equal(
    resolveAuditAssurance({
      aiCoverage: true,
      classification: "OK",
      mode: "enforce",
      selection,
      verificationCoverageComplete: true,
      verificationStatus: "PASS",
    }).band,
    "HIGH",
  );
  assert.equal(
    resolveAuditAssurance({
      aiCoverage: false,
      classification: "INFORMATION_INSUFFICIENT",
      mode: "enforce",
      selection,
      verificationCoverageComplete: true,
      verificationStatus: "PASS",
    }).band,
    "MEDIUM",
  );
});

test("achado independente sustentado promove suspeita sem remover achados anteriores", () => {
  const discovery = {
    ...aiFinding(),
    source: "AI_VERIFICATION" as const,
  };
  const result = evaluateHarness({
    aiDiscovery: {
      contextQuestions: [],
      coverage: {
        checkedAreas: ["totais"],
        limitations: [],
        sufficientEvidence: true,
      },
      findings: [],
      needsContext: false,
      summary: "Auditoria inicial sem achados.",
    },
    invoice: invoice(),
    verificationFindings: [discovery],
  });
  assert.equal(result.classification, "SUSPICIOUS");
  assert.equal(
    result.findings.some((finding) => finding.source === "AI_VERIFICATION"),
    true,
  );
});

test("falha do verificador não apaga suspeita já sustentada", () => {
  assert.equal(
    canRetainSuspiciousAfterVerificationFailure({
      classification: "SUSPICIOUS",
      findings: [aiFinding()],
    }),
    true,
  );
  assert.equal(
    canRetainSuspiciousAfterVerificationFailure({
      classification: "OK",
      findings: [],
    }),
    false,
  );
});

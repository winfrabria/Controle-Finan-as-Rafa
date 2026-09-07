import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerificationChecks,
  canRetainSuspiciousAfterVerificationFailure,
  explicitlyConfirmedVerificationFindings,
  evaluateHarness,
  resolveAuditAssurance,
  selectVerification,
  validateVerificationCoverage,
  VERIFICATION_JSON_SCHEMA,
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

test("schema do provedor exige vínculo explícito sem uniqueItems", () => {
  const serialized = JSON.stringify(VERIFICATION_JSON_SCHEMA);
  assert.equal(serialized.includes("confirmsInitialFindingCode"), true);
  assert.equal(serialized.includes("uniqueItems"), false);
});

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
      "SUPPORT_COVERAGE_NOT_COMPLETE",
      "LOW_READABLE_CONFIDENCE",
      "MULTIPLE_EXTRACTION_WARNINGS",
      "RECOVERED_EXTRACTION",
      "HIGH_VALUE",
      "AI_FINANCIAL_OR_DATE_CONFIRMATION_REQUIRED",
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
    confirmsInitialFindingCode: null,
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

test("resposta persistida antiga sem vínculo explícito continua legível", () => {
  const checks = buildVerificationChecks(invoice());
  const value = response(checks) as unknown as {
    findings: Array<Record<string, unknown>>;
  };
  value.findings = [{
    actualValue: null,
    category: "AMOUNT",
    code: "LEGACY_AMOUNT",
    confidence: 0.8,
    description: "Achado persistido antes do vínculo explícito.",
    evidence: {
      field: "total",
      lineNumber: 1,
      page: 1,
      source: "Página 1",
      summary: "Valor encontrado no documento.",
    },
    expectedValue: null,
    justification: "Registro histórico.",
    noteItemLineNumber: 1,
    references: ["Página 1"],
    severity: "WARNING",
    source: "AI_VERIFICATION",
    title: "Achado legado",
  }];

  const parsed = verificationResponseSchema.parse({
    ...value,
    status: "FINDINGS",
  });
  assert.equal(parsed.findings[0].confirmsInitialFindingCode, null);
});

test("achado sem check correspondente não pode certificar cobertura", () => {
  const checks = buildVerificationChecks(invoice());
  const value = response(checks);
  value.status = "FINDINGS";
  value.findings = [{
    ...aiFinding(),
    actualValue: "110.00",
    confirmsInitialFindingCode: null,
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
    confirmsInitialFindingCode: null,
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

test("falha do verificador preserva regra local, mas não hipótese financeira da IA", () => {
  assert.equal(
    canRetainSuspiciousAfterVerificationFailure({
      classification: "SUSPICIOUS",
      findings: [aiFinding()],
    }),
    false,
  );
  assert.equal(
    canRetainSuspiciousAfterVerificationFailure({
      classification: "SUSPICIOUS",
      findings: [{ ...aiFinding(), source: "UNIVERSAL_RULE" }],
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

test("AI_DISCOVERY financeiro sem verificação não vira suspeita", () => {
  const hypothesis = {
    ...aiFinding(),
    actualValue: "140.00",
    code: "INVOICE_BILLING_AMOUNT_MISMATCH",
    evidence: {
      field: "billingAmount",
      lineNumber: null,
      page: 4,
      source: "Texto extraído",
      summary: "A extração sugeriu dois valores diferentes.",
    },
    expectedValue: "910.00",
    source: "AI_DISCOVERY" as const,
  };
  const result = evaluateHarness({
    aiDiscovery: {
      contextQuestions: [],
      coverage: {
        checkedAreas: ["totais"],
        limitations: [],
        sufficientEvidence: true,
      },
      findings: [hypothesis],
      needsContext: false,
      summary: "Possível divergência de valor.",
    },
    invoice: invoice({ supplierTaxId: null }),
  });

  assert.equal(result.classification, "INFORMATION_INSUFFICIENT");
  assert.equal(result.findings.some((finding) => finding.code === hypothesis.code), false);
  assert.deepEqual(result.unconfirmedAiFindings.map((finding) => finding.code), [
    hypothesis.code,
  ]);
});

test("verificação explicitamente vinculada substitui a hipótese financeira", () => {
  const hypothesis = {
    ...aiFinding(),
    code: "INVOICE_BILLING_AMOUNT_MISMATCH",
    actualValue: "140.00",
    evidence: {
      field: "billingAmount",
      lineNumber: null,
      page: 1,
      source: "Texto extraído",
      summary: "A extração sugeriu dois valores diferentes.",
    },
    expectedValue: "R$ 910,00",
    source: "AI_DISCOVERY" as const,
  };
  const confirmed = {
    ...hypothesis,
    actualValue: "R$ 140,00",
    confirmsInitialFindingCode: hypothesis.code,
    evidence: {
      field: "billingAmount",
      lineNumber: null,
      page: 1,
      source: "Página 1 do documento original",
      summary: "Os dois valores estão legíveis no original.",
    },
    expectedValue: "910.00",
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
      findings: [hypothesis],
      needsContext: false,
      summary: "Possível divergência de valor.",
    },
    invoice: invoice({ supplierTaxId: null }),
    verificationFindings: [confirmed],
  });

  assert.equal(result.classification, "SUSPICIOUS");
  assert.equal(result.unconfirmedAiFindings.length, 0);
  const checks = buildVerificationChecks(invoice());
  const verificationResponse = response(checks);
  verificationResponse.status = "FINDINGS";
  verificationResponse.findings = [confirmed];
  verificationResponse.checks[1] = {
    ...verificationResponse.checks[1],
    evidence: [{
      field: "billingAmount",
      page: 1,
      quote: "Valores divergentes",
      source: "Página 1",
    }],
    findingCode: confirmed.code,
    state: "FINDING",
  };
  assert.equal(
    validateVerificationCoverage({
      expectedChecks: checks,
      expectedPageCount: 2,
      initialFindings: [hypothesis],
      response: verificationResponse,
    }).complete,
    true,
  );
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code === hypothesis.code &&
        finding.source === "AI_VERIFICATION",
    ),
    true,
  );
  assert.equal(
    result.findings.some((finding) => finding.source === "AI_DISCOVERY"),
    false,
  );
});

test("confirmação rejeita código, valores ou página divergentes", () => {
  const hypothesis = {
    ...aiFinding(),
    code: "INVOICE_BILLING_AMOUNT_MISMATCH",
    actualValue: "140.00",
    evidence: {
      field: "billingAmount",
      lineNumber: null,
      page: 1,
      source: "Texto extraído",
      summary: "A extração sugeriu dois valores diferentes.",
    },
    expectedValue: "910.00",
    source: "AI_DISCOVERY" as const,
  };
  const candidate = {
    ...hypothesis,
    confirmsInitialFindingCode: hypothesis.code,
    evidence: {
      field: "billingAmount",
      lineNumber: null,
      page: 1,
      source: "Página 1 do documento original",
      summary: "Valores conferidos no original.",
    },
    source: "AI_VERIFICATION" as const,
  };

  assert.equal(
    explicitlyConfirmedVerificationFindings(
      [hypothesis],
      [{ ...candidate, code: "OUTRO_CODIGO" }],
    ).length,
    0,
  );
  assert.equal(
    explicitlyConfirmedVerificationFindings(
      [hypothesis],
      [{ ...candidate, actualValue: "141.00" }],
    ).length,
    0,
  );

  const checks = buildVerificationChecks(invoice());
  const invalidPage = response(checks);
  invalidPage.status = "FINDINGS";
  invalidPage.findings = [{ ...candidate, evidence: { ...candidate.evidence, page: 3 } }];
  invalidPage.checks[1] = {
    ...invalidPage.checks[1],
    evidence: [{
      field: "billingAmount",
      page: 1,
      quote: "Valores divergentes",
      source: "Página 1",
    }],
    findingCode: candidate.code,
    state: "FINDING",
  };
  const coverage = validateVerificationCoverage({
    expectedChecks: checks,
    expectedPageCount: 2,
    initialFindings: [hypothesis],
    response: invalidPage,
  });
  assert.deepEqual(coverage.invalidFindingPages, [hypothesis.code]);
  assert.equal(coverage.complete, false);
});

test("hipótese não confirmada não remove achado determinístico local", () => {
  const hypothesis = {
    ...aiFinding(),
    actualValue: "140.00",
    code: "INVOICE_BILLING_AMOUNT_MISMATCH",
    evidence: {
      field: "billingAmount",
      lineNumber: null,
      page: 1,
      source: "Texto extraído",
      summary: "A extração sugeriu dois valores diferentes.",
    },
    expectedValue: "910.00",
    source: "AI_DISCOVERY" as const,
  };
  const result = evaluateHarness({
    aiDiscovery: {
      contextQuestions: [],
      coverage: {
        checkedAreas: ["totais"],
        limitations: [],
        sufficientEvidence: true,
      },
      findings: [hypothesis],
      needsContext: false,
      summary: "Possível divergência de valor.",
    },
    invoice: invoice({ supplierTaxId: "00000000000000" }),
  });

  assert.equal(result.classification, "SUSPICIOUS");
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code === "INVALID_CNPJ" &&
        finding.source === "UNIVERSAL_RULE",
    ),
    true,
  );
  assert.equal(
    result.findings.some((finding) => finding.code === hypothesis.code),
    false,
  );
});

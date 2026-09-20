import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerificationChecks,
  canRetainSuspiciousAfterVerificationFailure,
  explicitlyConfirmedVerificationFindings,
  evaluateHarness,
  normalizeVerificationFailureCode,
  resolveAuditAssurance,
  selectVerification,
  validateVerificationCoverage,
  VERIFICATION_JSON_SCHEMA,
  verificationResponseSchema,
  type HarnessFinding,
  type HarnessInvoice,
  type VerificationResponse,
} from "./index";

test("verificador confirma todos os valores de conflito sem inventar referência esperada", () => {
  const initial = { ...aiFinding(), source: "AI_DISCOVERY" as const, code: "AMOUNT_CONFLICT",
    category: "AMOUNTS", expectedValue: null, actualValue: ["30.00", "35.00"] };
  const confirmed = { ...aiFinding(), source: "AI_VERIFICATION" as const, code: initial.code,
    confirmsInitialFindingCode: initial.code, category: "AMOUNTS", expectedValue: null,
    evidence: { field: "valor", lineNumber: 1, page: 1, source: "Original sintético", summary: "R$ 35,00 e R$ 30,00 no original." },
    actualValue: "Recibo: R$ 35,00; ficha: R$ 30,00" };
  assert.equal(explicitlyConfirmedVerificationFindings([initial], [confirmed]).length, 1);
  for (const actualValue of ["R$ 35,00", "R$ 30,00; R$ 34,00", "R$ 30,00; R$ 35,00; R$ 40,00"]) {
    assert.equal(explicitlyConfirmedVerificationFindings([initial], [{ ...confirmed, actualValue }]).length, 0);
  }
});

test("verificador de conflito compara o conjunto exato de datas, aceitando ordem e formato distintos", () => {
  const initial = { ...aiFinding(), source: "AI_DISCOVERY" as const, code: "DATE_CONFLICT",
    category: "DATES", expectedValue: null, actualValue: "10/07/2026 × 11/07/2026" };
  const confirmed = { ...aiFinding(), source: "AI_VERIFICATION" as const, code: initial.code,
    evidence: { field: "data", lineNumber: 1, page: 1, source: "Original sintético", summary: "10/07/2026 e 11/07/2026 no original." },
    confirmsInitialFindingCode: initial.code, category: "DATES", expectedValue: "2026-07-11", actualValue: "2026-07-10" };
  assert.equal(explicitlyConfirmedVerificationFindings([initial], [confirmed]).length, 1);
  assert.equal(explicitlyConfirmedVerificationFindings([initial], [{ ...confirmed, actualValue: "2026-07-12" }]).length, 0);
});

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
      evidence: check.key === "document:coverage"
        ? [1, 2].map((page) => ({ page, field: "cobertura", quote: `Registro sintético legível da página ${page}.`, source: "Documento original sintético" }))
        : [{ page: 1, field: "valor", quote: "Item 1: R$ 100,00; total R$ 100,00.", source: "Documento original sintético" }],
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
      "COMPLEX_MULTI_PAGE_DOCUMENT",
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

function selfDeclaredCompleteInvoice(kind: HarnessInvoice["documentKind"]): HarnessInvoice {
  return invoice({ documentKind: kind, supportCoverage: { status: "COMPLETE",
    basis: "EXPLICIT_COMPLETENESS_STATEMENT", evidence: "Todas as fontes estão presentes (declaração sintética).",
    referencedDocuments: [], presentDocuments: [], missingDocuments: [] } });
}

test("composto ou reembolso de cinco páginas ou mais não dispensa verificação por autodeclarar cobertura", () => {
  for (const kind of ["COMPOSITE", "REIMBURSEMENT"] as const) {
    for (const pageCount of [5, 8, 32]) {
      const selected = selectVerification({ aiCoverage: true, baseClassification: "OK", baseFindings: [],
        invoice: selfDeclaredCompleteInvoice(kind), pageCount });
      assert.equal(selected.required, true, `${kind}, ${pageCount} páginas`);
      assert.ok(selected.reasons.includes("COMPLEX_MULTI_PAGE_DOCUMENT"));
      assert.equal(resolveAuditAssurance({ aiCoverage: true, classification: "OK", mode: "shadow",
        selection: selected, verificationStatus: "NOT_RUN" }).band, "LIMITED");
    }
  }
});

test("documento longo exige verificação mesmo classificado como nota fiscal simples", () => {
  const selected = selectVerification({ aiCoverage: true, baseClassification: "OK", baseFindings: [],
    invoice: selfDeclaredCompleteInvoice("FISCAL_INVOICE"), pageCount: 10 });
  assert.equal(selected.required, true);
  assert.ok(selected.reasons.includes("LONG_DOCUMENT"));
});

test("quantidade de páginas desconhecida não elimina o risco de documento composto", () => {
  for (const pageCount of [undefined, null, 0, -1, 2.5, Number.NaN]) {
    const selected = selectVerification({ aiCoverage: true, baseClassification: "OK", baseFindings: [],
      invoice: selfDeclaredCompleteInvoice("COMPOSITE"), pageCount });
    assert.equal(selected.required, true);
    assert.ok(selected.reasons.includes("COMPLEX_PAGE_COUNT_UNKNOWN"));
  }
});

test("nota curta com cobertura completa mantém seleção enxuta e não altera o documento", () => {
  for (const [kind, pageCount] of [["FISCAL_INVOICE", 2], ["COMPOSITE", 4]] as const) {
    const document = selfDeclaredCompleteInvoice(kind); const before = structuredClone(document);
    assert.deepEqual(selectVerification({ aiCoverage: true, baseClassification: "OK", baseFindings: [],
      invoice: document, pageCount }), { required: false, reasons: [] });
    assert.deepEqual(document, before);
  }
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

test("PASS sem trechos por check não comprova cobertura", () => {
  const checks = buildVerificationChecks(invoice());
  const value = response(checks);
  value.checks.forEach((check) => { check.evidence = []; });
  const coverage = validateVerificationCoverage({ expectedChecks: checks, expectedPageCount: 2, response: value });
  assert.equal(coverage.complete, false);
});

test("chave correta não permite trocar a linha, o grupo ou o papel conferido", () => {
  const checks = buildVerificationChecks(invoice());
  for (const identity of [{ lineNumber: 2 }, { documentGroup: "outro-grupo" }, { documentRole: "SUMMARY" as const }]) {
    const value = response(checks);
    Object.assign(value.checks.find((check) => check.key === "line:1")!, identity);
    assert.equal(validateVerificationCoverage({ expectedChecks: checks, expectedPageCount: 2, response: value }).complete, false);
  }
});

test("páginas declaradas precisam ser únicas, válidas e apoiadas por trechos", () => {
  const checks = buildVerificationChecks(invoice());
  for (const checkedPages of [[1, 2, 2], [1, 2, 3]]) {
    const value = response(checks);
    value.pageCoverage.checkedPages = checkedPages;
    assert.equal(validateVerificationCoverage({ expectedChecks: checks, expectedPageCount: 2, response: value }).complete, false);
  }
  const unsupportedPage = response(checks);
  unsupportedPage.checks.forEach((check) => { check.evidence = check.evidence.filter((item) => item.page === 1); });
  assert.equal(validateVerificationCoverage({ expectedChecks: checks, expectedPageCount: 2, response: unsupportedPage }).complete, false);
  const outsidePage = response(checks);
  outsidePage.checks[1].evidence[0].page = 3;
  assert.equal(validateVerificationCoverage({ expectedChecks: checks, expectedPageCount: 2, response: outsidePage }).complete, false);
});

test("limitação declarada impede certificado de cobertura completa", () => {
  const checks = buildVerificationChecks(invoice());
  const value = response(checks);
  value.status = "LIMITED";
  value.limitations = ["Parte de um comprovante está ilegível."];
  assert.equal(validateVerificationCoverage({ expectedChecks: checks, expectedPageCount: 2, response: value }).complete, false);
});

test("shadow sem cobertura comprovada permanece limitado mesmo com PASS declarado", () => {
  assert.equal(resolveAuditAssurance({ aiCoverage: true, classification: "OK", mode: "shadow",
    selection: { required: true, reasons: ["RECOVERED_EXTRACTION"] }, verificationStatus: "PASS", verificationCoverageComplete: false }).band, "LIMITED");
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

test("faixa de garantia não expõe score e distingue auditoria coberta sem verificador", () => {
  const selection = { required: true, reasons: ["LONG_DOCUMENT"] };
  assert.equal(
    resolveAuditAssurance({
      aiCoverage: true,
      classification: "OK",
      mode: "off",
      selection,
      verificationStatus: "NOT_RUN",
    }).band,
    "MEDIUM",
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

test("falhas operacionais da IA são distintas de falta de documentos, sem ampliar garantia", () => {
  for (const mode of ["shadow", "enforce"] as const) {
    for (const code of ["VERIFICATION_TIMEOUT", "VERIFICATION_ENDPOINT_UNAVAILABLE", "VERIFICATION_PROVIDER_ERROR"] as const) {
      const input = { aiCoverage: true, classification: "OK" as const, mode,
        selection: { required: true, reasons: ["LONG_DOCUMENT"] }, verificationStatus: "FAILED" as const,
        verificationFailureCode: code };
      const assurance = resolveAuditAssurance(input);
      assert.equal(assurance.band, "LIMITED");
      assert.match(assurance.reason, /não comprova falta de informação no documento/);
      assert.doesNotMatch(resolveAuditAssurance({ ...input, mode: "off" }).reason, /serviço de IA/);
    }
  }
});

test("normalização de falha nunca exibe erro bruto, segredo ou código arbitrário", () => {
  for (const value of ["PRIVATE_PROVIDER_MESSAGE", null, { code: "PRIVATE" }, 503]) {
    assert.equal(normalizeVerificationFailureCode(value), "VERIFICATION_PROVIDER_ERROR");
  }
  assert.equal(normalizeVerificationFailureCode("VERIFICATION_ENDPOINT_UNAVAILABLE"), "VERIFICATION_ENDPOINT_UNAVAILABLE");
  assert.equal(normalizeVerificationFailureCode("VERIFICATION_REFERENCE_CHANGED"), "VERIFICATION_REFERENCE_CHANGED");
});

test("mudança da regra limita a garantia sem culpar o documento ou repetir a IA", () => {
  for (const mode of ["shadow", "enforce"] as const) {
    const assurance = resolveAuditAssurance({ aiCoverage: true, classification: "OK", mode,
      selection: { required: true, reasons: ["LONG_DOCUMENT"] }, verificationStatus: "FAILED",
      verificationFailureCode: "VERIFICATION_REFERENCE_CHANGED" });
    assert.equal(assurance.band, "LIMITED");
    assert.match(assurance.reason, /regras da obra mudaram/);
    assert.match(assurance.reason, /nenhuma nova chamada/);
  }
});

test("mudança da hipótese não reutiliza decisão antiga nem culpa o documento", () => {
  assert.equal(normalizeVerificationFailureCode("VERIFICATION_HYPOTHESES_CHANGED"), "VERIFICATION_HYPOTHESES_CHANGED");
  const assurance = resolveAuditAssurance({ aiCoverage: true, classification: "OK", mode: "shadow",
    selection: { required: true, reasons: ["LONG_DOCUMENT"] }, verificationStatus: "FAILED",
    verificationFailureCode: "VERIFICATION_HYPOTHESES_CHANGED" });
  assert.equal(assurance.band, "LIMITED");
  assert.match(assurance.reason, /hipóteses mudaram/);
  assert.match(assurance.reason, /nenhuma nova chamada/);
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

  assert.equal(result.classification, "OK");
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

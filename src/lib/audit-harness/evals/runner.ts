import type { ContextQuestion, HarnessFinding, HarnessInvoice } from "../contracts";
import { harnessFindingSchema } from "../contracts";
import { isSupportedFinding } from "../decision-matrix";
import { deduplicateHarnessFindings, evaluateHarness } from "../engine";
import { sanitizeForPersistence } from "../security";
import { HARNESS_VERSIONS } from "../versions";
import type {
  GoldenCase,
  GoldenCaseExpectations,
} from "./golden-case-schema";

export const GOLDEN_CASES_EVAL_MODE = "offline" as const;

export type GoldenCaseCheck = {
  name: string;
  passed: boolean;
  details?: string;
};

export type GoldenCaseResult = {
  id: string;
  title: string;
  category: string;
  passed: boolean;
  classification: string;
  findingCodes: string[];
  contextQuestionCodes: string[];
  semanticDuplicateCount: number;
  coverageAreas: string[];
  checks: GoldenCaseCheck[];
};

export type GoldenCasesReport = {
  contractVersion: string;
  mode: typeof GOLDEN_CASES_EVAL_MODE;
  versions: typeof HARNESS_VERSIONS;
  totals: {
    cases: number;
    passed: number;
    failed: number;
  };
  metrics: {
    classificationAccuracy: number;
    classificationMacroPrecision: number;
    classificationMacroRecall: number;
    classificationMacroF1: number;
    classificationByLabel: Record<
      string,
      {
        support: number;
        truePositives: number;
        falsePositives: number;
        falseNegatives: number;
        precision: number;
        recall: number;
        f1: number;
      }
    >;
    schemaValidityRate: number;
    evidenceTraceabilityViolations: number;
    forbiddenFindingViolations: number;
    semanticDuplicationRate: number;
    contextQuestionViolations: number;
    coverageAreaViolations: number;
    forbiddenOutputViolations: number;
  };
  /** Campos de custo/latência só têm valor em execução online opt-in. */
  onlineTelemetry: {
    providerCalls: number;
    retries: number;
    costUsd: null;
    latencyMsP50: null;
    latencyMsP95: null;
    evaluated: false;
  };
  results: GoldenCaseResult[];
};

const MONEY_TOKEN_PATTERN =
  /R\$\s*\d[\d.\s]*(?:,\d{2}|\.\d{2})\b|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/giu;
const DATE_TOKEN_PATTERN =
  /\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:\d{2}|\d{4})\b/gu;
const CONTRADICTION_PATTERN =
  /\b(?:diverg\w*|diferen\w*|enquanto|versus|vs\.?|n[aã]o\s+(?:confere|corresponde|bate))\b/iu;

/**
 * Gate 5 do PRD: contradição objetiva (dois valores ou duas datas no próprio
 * anexo) não pode permanecer como pergunta de contexto. O engine já promove
 * esses casos para achado; o runner reconfere de forma independente.
 */
export function emittedQuestionHasObjectiveContradiction(
  question: ContextQuestion,
): boolean {
  const prompt = question.prompt;
  if (!CONTRADICTION_PATTERN.test(prompt)) return false;

  const moneyValues = new Set(
    (prompt.match(MONEY_TOKEN_PATTERN) ?? []).map((value) =>
      value.replace(/\s+/g, "").toLocaleLowerCase("pt-BR"),
    ),
  );
  if (moneyValues.size >= 2) return true;

  const dateValues = new Set(prompt.match(DATE_TOKEN_PATTERN) ?? []);
  return dateValues.size >= 2;
}

/** Conta achados semanticamente duplicados usando a mesma chave do engine. */
export function countSemanticDuplicates(findings: HarnessFinding[]): number {
  return findings.length - deduplicateHarnessFindings(findings).length;
}

function checkEvidenceTraceability(
  findings: HarnessFinding[],
): GoldenCaseCheck {
  const unsupported = findings.filter(
    (finding) => finding.severity !== "INFO" && !isSupportedFinding(finding),
  );
  return {
    name: "evidenceTraceability",
    passed: unsupported.length === 0,
    details:
      unsupported.length > 0
        ? `Achados sem evidência rastreável: ${unsupported.map((finding) => finding.code).join(", ")}.`
        : undefined,
  };
}

function checkTotalMismatchCoverage(
  invoice: HarnessInvoice,
  findings: HarnessFinding[],
): GoldenCaseCheck {
  const hasTotalMismatch = findings.some(
    (finding) => finding.code === "TOTAL_MISMATCH",
  );
  const coverageComplete = invoice.itemCoverage?.status === "COMPLETE";
  return {
    name: "totalMismatchRequiresCompleteCoverage",
    passed: !hasTotalMismatch || coverageComplete,
    details:
      hasTotalMismatch && !coverageComplete
        ? "TOTAL_MISMATCH emitido sem cobertura COMPLETE dos itens."
        : undefined,
  };
}

function checkWorkRulesSupplied(
  workRules: { code: string }[],
  findings: HarnessFinding[],
): GoldenCaseCheck {
  const suppliedPrefixes = workRules.map((rule) => `${rule.code}_`);
  const unsupplied = findings.filter(
    (finding) =>
      finding.source === "WORK_RULE" &&
      !suppliedPrefixes.some((prefix) => finding.code.startsWith(prefix)),
  );
  return {
    name: "workRuleOnlyWithSuppliedParameters",
    passed: unsupplied.length === 0,
    details:
      unsupplied.length > 0
        ? `Regra de obra aplicada sem parâmetro fornecido: ${unsupplied.map((finding) => finding.code).join(", ")}.`
        : undefined,
  };
}

function checkSecretLeak(result: {
  classification: string;
  findings: HarnessFinding[];
  contextQuestions: ContextQuestion[];
  coverage: unknown;
}): GoldenCaseCheck {
  // O payload público persistido não pode conter segredo nem raciocínio
  // interno (PRD §3). O campo interno `reasoning` do engine nunca entra aqui.
  const publicPayload = {
    classification: result.classification,
    findings: result.findings,
    contextQuestions: result.contextQuestions,
    coverage: result.coverage,
  };
  const serialized = JSON.stringify(publicPayload);
  const sanitized = JSON.stringify(sanitizeForPersistence(publicPayload));
  return {
    name: "noSecretOrInternalReasoning",
    passed: serialized === sanitized,
    details:
      serialized !== sanitized
        ? "Payload público contém chaves sensíveis (segredo, raciocínio interno)."
        : undefined,
  };
}

function checkRequiredCoverageAreas(
  requiredAreas: string[],
  actualAreas: string[],
): GoldenCaseCheck {
  const actual = new Set(actualAreas);
  const missing = requiredAreas.filter((area) => !actual.has(area));
  return {
    name: "requiredCoverageAreas",
    passed: missing.length === 0,
    details:
      missing.length > 0
        ? `Areas obrigatorias nao exercitadas: ${missing.join(", ")}.`
        : undefined,
  };
}

function checkForbiddenOutputFragments(
  forbiddenFragments: string[],
  publicResult: unknown,
): GoldenCaseCheck {
  const serialized = JSON.stringify(publicResult).toLocaleLowerCase("pt-BR");
  const leaked = forbiddenFragments.filter((fragment) =>
    serialized.includes(fragment.toLocaleLowerCase("pt-BR")),
  );
  return {
    name: "forbiddenOutputFragments",
    passed: leaked.length === 0,
    details:
      leaked.length > 0
        ? `Conteudo nao confiavel do OCR propagado (${leaked.length} ocorrencia(s)).`
        : undefined,
  };
}

function checkContextQuestions(
  expectations: GoldenCaseExpectations,
  questions: ContextQuestion[],
): GoldenCaseCheck[] {
  const codes = questions.map((question) => question.code);
  const missingRequired = expectations.requiredContextQuestionCodes.filter(
    (code) => !codes.includes(code),
  );
  const foundForbidden = codes.filter((code) =>
    expectations.forbiddenContextQuestionCodes.includes(code),
  );
  const contradictionQuestions = questions.filter(
    emittedQuestionHasObjectiveContradiction,
  );

  return [
    {
      name: "requiredContextQuestions",
      passed: missingRequired.length === 0,
      details:
        missingRequired.length > 0
          ? `Perguntas obrigatórias ausentes: ${missingRequired.join(", ")}.`
          : undefined,
    },
    {
      name: "forbiddenContextQuestions",
      passed:
        foundForbidden.length === 0 && contradictionQuestions.length === 0,
      details:
        foundForbidden.length > 0
          ? `Perguntas proibidas emitidas: ${foundForbidden.join(", ")}.`
          : contradictionQuestions.length > 0
            ? `Contradição objetiva convertida em pergunta: ${contradictionQuestions.map((question) => question.code).join(", ")}.`
            : undefined,
    },
  ];
}

function runGoldenCase(goldenCase: GoldenCase): GoldenCaseResult {
  const { input, expectations } = goldenCase;
  const result = evaluateHarness({
    invoice: input.invoice as HarnessInvoice,
    workRules: input.workRules,
    duplicates: input.duplicates,
    aiDiscovery: input.aiDiscovery,
    now: new Date(`${input.now}T00:00:00.000Z`),
  });

  const checks: GoldenCaseCheck[] = [];

  const invalidSchemaFindings = result.findings.filter(
    (finding) => !harnessFindingSchema.safeParse(finding).success,
  );
  checks.push({
    name: "schemaValidity",
    passed: invalidSchemaFindings.length === 0,
    details:
      invalidSchemaFindings.length > 0
        ? `Achados fora do schema: ${invalidSchemaFindings.map((finding) => finding.code).join(", ")}.`
        : undefined,
  });

  const classificationOk = (
    expectations.acceptableClassifications as string[]
  ).includes(result.classification);
  checks.push({
    name: "classification",
    passed: classificationOk,
    details: classificationOk
      ? undefined
      : `Classificação "${result.classification}" não está entre as aceitáveis (${expectations.acceptableClassifications.join(", ")}).`,
  });

  const missingRequired = expectations.requiredFindingCodes.filter(
    (code) => !result.findings.some((finding) => finding.code === code),
  );
  checks.push({
    name: "requiredFindings",
    passed: missingRequired.length === 0,
    details:
      missingRequired.length > 0
        ? `Achados obrigatórios ausentes: ${missingRequired.join(", ")}.`
        : undefined,
  });

  const forbiddenFound = result.findings.filter((finding) =>
    expectations.forbiddenFindingCodes.includes(finding.code),
  );
  checks.push({
    name: "forbiddenFindings",
    passed: forbiddenFound.length === 0,
    details:
      forbiddenFound.length > 0
        ? `Achados proibidos emitidos: ${[...new Set(forbiddenFound.map((finding) => finding.code))].join(", ")}.`
        : undefined,
  });

  checks.push(...checkContextQuestions(expectations, result.contextQuestions));
  checks.push(checkEvidenceTraceability(result.findings));
  checks.push(checkTotalMismatchCoverage(input.invoice as HarnessInvoice, result.findings));
  checks.push(checkWorkRulesSupplied(input.workRules, result.findings));

  const semanticDuplicateCount = countSemanticDuplicates(result.findings);
  checks.push({
    name: "semanticDuplication",
    passed: semanticDuplicateCount <= expectations.maxSemanticDuplicates,
    details:
      semanticDuplicateCount > expectations.maxSemanticDuplicates
        ? `${semanticDuplicateCount} duplicatas semânticas acima do máximo declarado (${expectations.maxSemanticDuplicates}).`
        : undefined,
  });

  checks.push(checkSecretLeak(result));
  checks.push(
    checkRequiredCoverageAreas(
      expectations.requiredCoverageAreas,
      result.coverage.areas,
    ),
  );
  checks.push(
    checkForbiddenOutputFragments(expectations.forbiddenOutputFragments, {
      classification: result.classification,
      findings: result.findings,
      contextQuestions: result.contextQuestions,
      coverage: result.coverage,
    }),
  );

  return {
    id: goldenCase.id,
    title: goldenCase.title,
    category: goldenCase.category,
    passed: checks.every((check) => check.passed),
    classification: result.classification,
    findingCodes: result.findings.map((finding) => finding.code),
    contextQuestionCodes: result.contextQuestions.map(
      (question) => question.code,
    ),
    semanticDuplicateCount,
    coverageAreas: result.coverage.areas,
    checks,
  };
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function classificationMetrics(
  cases: GoldenCase[],
  results: GoldenCaseResult[],
) {
  const pairs = results.map((result, index) => {
    const acceptable = cases[index]?.expectations.acceptableClassifications ?? [];
    // Quando o contrato permite mais de uma saída, uma saída aceita vira a
    // referência daquela execução. Se houve erro, a primeira opção declarada
    // continua sendo a verdade de referência canônica.
    const expected = (acceptable as readonly string[]).includes(
      result.classification,
    )
      ? result.classification
      : (acceptable[0] ?? "UNKNOWN");
    return { actual: result.classification, expected };
  });
  const labels = [
    ...new Set(pairs.flatMap((pair) => [pair.expected, pair.actual])),
  ].sort();
  const byLabel = Object.fromEntries(
    labels.map((label) => {
      const truePositives = pairs.filter(
        (pair) => pair.expected === label && pair.actual === label,
      ).length;
      const falsePositives = pairs.filter(
        (pair) => pair.expected !== label && pair.actual === label,
      ).length;
      const falseNegatives = pairs.filter(
        (pair) => pair.expected === label && pair.actual !== label,
      ).length;
      const support = pairs.filter((pair) => pair.expected === label).length;
      const precision =
        truePositives + falsePositives === 0
          ? 0
          : truePositives / (truePositives + falsePositives);
      const recall =
        truePositives + falseNegatives === 0
          ? 0
          : truePositives / (truePositives + falseNegatives);
      const f1 =
        precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall);
      return [
        label,
        {
          support,
          truePositives,
          falsePositives,
          falseNegatives,
          precision,
          recall,
          f1,
        },
      ];
    }),
  );
  const values = Object.values(byLabel);
  const macro = (field: "precision" | "recall" | "f1") =>
    values.length === 0
      ? 1
      : values.reduce((sum, value) => sum + value[field], 0) / values.length;
  return {
    byLabel,
    macroF1: macro("f1"),
    macroPrecision: macro("precision"),
    macroRecall: macro("recall"),
  };
}

export function runGoldenCases(cases: GoldenCase[]): GoldenCasesReport {
  const results = cases.map(runGoldenCase);
  const passed = results.filter((result) => result.passed).length;
  const schemaValidResults = results.filter((result) =>
    result.checks.find((check) => check.name === "schemaValidity")?.passed,
  ).length;
  const classifications = classificationMetrics(cases, results);

  return {
    contractVersion: cases[0]?.contractVersion ?? "unknown",
    mode: GOLDEN_CASES_EVAL_MODE,
    versions: HARNESS_VERSIONS,
    totals: {
      cases: results.length,
      passed,
      failed: results.length - passed,
    },
    metrics: {
      classificationAccuracy: rate(
        results.filter((result) =>
          result.checks.find((check) => check.name === "classification")?.passed,
        ).length,
        results.length,
      ),
      classificationMacroPrecision: classifications.macroPrecision,
      classificationMacroRecall: classifications.macroRecall,
      classificationMacroF1: classifications.macroF1,
      classificationByLabel: classifications.byLabel,
      schemaValidityRate: rate(schemaValidResults, results.length),
      evidenceTraceabilityViolations: results.filter(
        (result) =>
          !result.checks.find((check) => check.name === "evidenceTraceability")
            ?.passed,
      ).length,
      forbiddenFindingViolations: results.filter(
        (result) =>
          !result.checks.find((check) => check.name === "forbiddenFindings")
            ?.passed,
      ).length,
      semanticDuplicationRate: results.filter(
        (result) =>
          !result.checks.find((check) => check.name === "semanticDuplication")
            ?.passed,
      ).length / Math.max(results.length, 1),
      contextQuestionViolations: results.filter(
        (result) =>
          !result.checks.find((check) => check.name === "forbiddenContextQuestions")
            ?.passed ||
          !result.checks.find((check) => check.name === "requiredContextQuestions")
            ?.passed,
      ).length,
      coverageAreaViolations: results.filter(
        (result) =>
          !result.checks.find((check) => check.name === "requiredCoverageAreas")
            ?.passed,
      ).length,
      forbiddenOutputViolations: results.filter(
        (result) =>
          !result.checks.find(
            (check) => check.name === "forbiddenOutputFragments",
          )?.passed,
      ).length,
    },
    // Execução offline: nenhum provedor é chamado; telemetria fica nula.
    onlineTelemetry: {
      providerCalls: 0,
      retries: 0,
      costUsd: null,
      latencyMsP50: null,
      latencyMsP95: null,
      evaluated: false,
    },
    results,
  };
}

export function formatReadableSummary(report: GoldenCasesReport): string {
  const lines: string[] = [];
  lines.push(
    `Harness Golden Cases — contrato ${report.contractVersion} (modo ${report.mode}, offline determinístico)`,
  );
  lines.push(
    `Versões — policy ${report.versions.policy} · rules ${report.versions.rules} · schema ${report.versions.schema}`,
  );
  lines.push(
    `Casos: ${report.totals.cases} · aprovados: ${report.totals.passed} · reprovados: ${report.totals.failed}`,
  );
  lines.push("Métricas:");
  lines.push(
    `  acurácia de classificação: ${(report.metrics.classificationAccuracy * 100).toFixed(1)}%`,
  );
  lines.push(
    `  precisão macro: ${(report.metrics.classificationMacroPrecision * 100).toFixed(1)}% · recall macro: ${(report.metrics.classificationMacroRecall * 100).toFixed(1)}% · F1 macro: ${(report.metrics.classificationMacroF1 * 100).toFixed(1)}%`,
  );
  lines.push(`  validade de schema: ${(report.metrics.schemaValidityRate * 100).toFixed(1)}%`);
  lines.push(
    `  casos com achado sem evidência rastreável: ${report.metrics.evidenceTraceabilityViolations}`,
  );
  lines.push(
    `  casos com achado proibido emitido: ${report.metrics.forbiddenFindingViolations}`,
  );
  lines.push(
    `  taxa de casos acima do limite de duplicação semântica: ${(report.metrics.semanticDuplicationRate * 100).toFixed(1)}%`,
  );
  lines.push(
    `  casos com violação em perguntas de contexto: ${report.metrics.contextQuestionViolations}`,
  );
  lines.push(
    `  casos sem cobertura obrigatoria: ${report.metrics.coverageAreaViolations}`,
  );
  lines.push(
    `  casos com propagacao de texto OCR proibido: ${report.metrics.forbiddenOutputViolations}`,
  );
  lines.push(
    "Telemetria online: não avaliada no modo offline (0 chamadas de provedor).",
  );

  for (const result of report.results) {
    lines.push(
      `[${result.passed ? "ok" : "FAIL"}] ${result.id} → ${result.classification}${result.findingCodes.length > 0 ? ` (${result.findingCodes.join(", ")})` : ""}`,
    );
    for (const check of result.checks) {
      if (!check.passed) {
        lines.push(`       ✗ ${check.name}: ${check.details ?? "falhou."}`);
      }
    }
  }

  return lines.join("\n");
}

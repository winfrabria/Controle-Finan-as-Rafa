import type {
  AiDiscoveryResponse,
  ContextQuestion,
  DuplicateCandidate,
  HarnessFinding,
  HarnessInvoice,
  WorkRuleInput,
} from "./contracts";
import { decideClassification } from "./decision-matrix";
import { isReadFailure, selectReasoningEffort } from "./policy";
import { evaluateUniversalRules, evaluateWorkRules } from "./rules";
import { HARNESS_VERSIONS } from "./versions";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const MONEY_TOKEN_PATTERN =
  /R\$\s*\d[\d.\s]*(?:,\d{2}|\.\d{2})\b|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/giu;
const DATE_TOKEN_PATTERN =
  /\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:\d{2}|\d{4})\b/gu;
const INTERNAL_CONTRADICTION_PATTERN =
  /\b(?:diverg\w*|diferen\w*|enquanto|versus|vs\.?|n[aã]o\s+(?:confere|corresponde|bate)|para\s+resultar|se\s+(?:o|a|os|as))\b/iu;

function normalizeComparableToken(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function distinctMatches(value: string, pattern: RegExp) {
  const seen = new Set<string>();
  return (value.match(pattern) ?? []).filter((match) => {
    const normalized = normalizeComparableToken(match);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function objectiveContradiction(question: ContextQuestion) {
  const text = `${question.prompt} ${question.rationale}`;
  if (!INTERNAL_CONTRADICTION_PATTERN.test(text)) return null;

  const moneyValues = distinctMatches(question.prompt, MONEY_TOKEN_PATTERN);
  if (moneyValues.length >= 2) {
    return { field: "valor", kind: "AMOUNT" as const, values: moneyValues };
  }

  const dateValues = distinctMatches(question.prompt, DATE_TOKEN_PATTERN);
  if (dateValues.length >= 2) {
    return { field: "data", kind: "DATE" as const, values: dateValues };
  }

  return null;
}

function findingAlreadyCoversValues(
  findings: HarnessFinding[],
  values: string[],
) {
  return findings.some((finding) => {
    const serialized = normalizeComparableToken(JSON.stringify(finding) ?? "");
    return values.every((value) =>
      serialized.includes(normalizeComparableToken(value)),
    );
  });
}

function contradictionFinding(
  question: ContextQuestion,
  contradiction: NonNullable<ReturnType<typeof objectiveContradiction>>,
): HarnessFinding {
  const isDate = contradiction.kind === "DATE";
  const codeSuffix = question.code
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(0, 68);
  const comparison = contradiction.values.join(" × ");

  return {
    code: `INTERNAL_CONTRADICTION_${codeSuffix}`,
    title: isDate
      ? "Datas divergentes no documento"
      : "Valores divergentes no documento",
    description: `O anexo apresenta registros conflitantes no mesmo conjunto documental: ${comparison}.`,
    category: isDate ? "DATES" : "AMOUNTS",
    severity: "WARNING",
    source: "AI_DISCOVERY",
    confidence: 0.9,
    justification:
      "A divergência está registrada no próprio anexo e independe de contexto externo para ser apontada.",
    references: [],
    evidence: {
      summary: question.prompt.replace(/\?+\s*$/, "."),
      field: contradiction.field,
      source: "Documento enviado",
      page: null,
      lineNumber: null,
    },
    expectedValue: isDate
      ? "Datas coerentes entre ficha e comprovante"
      : "Valores coerentes ou ajuste explicitado no documento",
    actualValue: comparison,
    noteItemLineNumber: null,
  };
}

/**
 * Contradições verificáveis no próprio anexo são achados, não perguntas.
 * A proteção é aplicada depois do schema para não depender apenas do prompt.
 */
export function routeContextQuestions(
  questions: ContextQuestion[],
  existingFindings: HarnessFinding[] = [],
) {
  const contextQuestions: ContextQuestion[] = [];
  const promotedFindings: HarnessFinding[] = [];

  for (const question of questions) {
    const contradiction = objectiveContradiction(question);
    if (!contradiction) {
      contextQuestions.push(question);
      continue;
    }

    if (
      !findingAlreadyCoversValues(
        [...existingFindings, ...promotedFindings],
        contradiction.values,
      )
    ) {
      promotedFindings.push(contradictionFinding(question, contradiction));
    }
  }

  return { contextQuestions, promotedFindings };
}

export function deduplicateHarnessFindings<T extends {
  actualValue: unknown;
  category: string;
  code: string;
  evidence: Record<string, unknown>;
  expectedValue: unknown;
  noteItemLineNumber: number | null;
}>(findings: T[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = stableJson({
      actualValue: finding.actualValue,
      category: finding.category,
      expectedValue: finding.expectedValue,
      field: finding.evidence.field ?? null,
      lineNumber:
        finding.noteItemLineNumber ?? finding.evidence.lineNumber ?? null,
      page: finding.evidence.page ?? null,
      summary:
        finding.expectedValue === null &&
        finding.actualValue === null &&
        typeof finding.evidence.summary === "string"
          ? finding.evidence.summary.trim().toLocaleLowerCase("pt-BR")
          : null,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evaluateHarness(input: {
  invoice: HarnessInvoice;
  workRules?: WorkRuleInput[];
  duplicates?: DuplicateCandidate[];
  aiDiscovery?: AiDiscoveryResponse;
  now?: Date;
}) {
  const readFailed = isReadFailure(input.invoice);
  if (readFailed) {
    return {
      classification: "READ_FAILED" as const,
      contextQuestions: [],
      findings: [],
      coverage: { deterministic: false, ai: false, areas: [] as string[] },
      reasoning: { effort: "high" as const, triggers: [] as string[] },
      versions: HARNESS_VERSIONS,
    };
  }

  const universal = evaluateUniversalRules({
    invoice: input.invoice,
    duplicates: input.duplicates,
    now: input.now,
  });
  const work = evaluateWorkRules(input.invoice, input.workRules ?? []);
  const aiFindings = input.aiDiscovery?.findings ?? [];
  const routedContext = routeContextQuestions(
    input.aiDiscovery?.contextQuestions ?? [],
    aiFindings,
  );
  const findings = deduplicateHarnessFindings([
    ...universal.findings,
    ...work.findings,
    ...aiFindings,
    ...routedContext.promotedFindings,
  ]);
  const deterministicCoverage = universal.covered || work.covered;
  const aiCoverage = input.aiDiscovery?.coverage.sufficientEvidence ?? false;
  const contextQuestions = routedContext.contextQuestions;
  const contextRequired =
    contextQuestions.length > 0 && (input.aiDiscovery?.needsContext ?? false);

  const classification = decideClassification({
    contextQuestions: contextQuestions.length,
    contextRequired,
    readFailed: false,
    deterministicCoverage,
    aiCoverage,
    findings,
  });

  return {
    classification,
    findings,
    contextQuestions: classification === "NEEDS_CONTEXT" ? contextQuestions : [],
    coverage: {
      deterministic: deterministicCoverage,
      ai: aiCoverage,
      areas: [
        ...universal.coveredAreas,
        ...(input.aiDiscovery?.coverage.checkedAreas ?? []),
      ],
    },
    reasoning: selectReasoningEffort(input.invoice, findings),
    versions: HARNESS_VERSIONS,
  };
}

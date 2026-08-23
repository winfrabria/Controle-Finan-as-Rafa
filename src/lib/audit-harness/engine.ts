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
  /\b(?:diverg\w*|diferen\w*|enquanto|versus|vs\.?|n[aã]o\s+(?:confere|corresponde|bate)|para\s+resultar)\b/iu;
const EXTERNAL_CONTEXT_PATTERN =
  /\b(?:fato|dado|informa[çc][aã]o|par[aâ]metro|cadastro|autoriza[çc][aã]o|aprova[çc][aã]o)\s+extern\w*\b|\b(?:n[aã]o|sem)\s+(?:consta\w*|informa\w*|presen\w*|dispon[ií]v\w*|cadastr\w*)\s+(?:no|na|nos|nas|em)\s+(?:anexo|documento|nota|comprovante|sistema|cadastro)\b|\b(?:autoriza[çc][aã]o|aprova[çc][aã]o)[\s\S]{0,60}\b(?:pendente|extern\w*|da\s+obra)\b/iu;

function normalizeComparableToken(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function normalizeComparableMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `money:${value.toFixed(2)}`;
  }
  if (typeof value !== "string") return value;

  const compact = value
    .trim()
    .replace(/^R\$\s*/iu, "")
    .replace(/\s+/g, "");
  if (!/^-?[\d.,]+$/u.test(compact)) return value;

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = compact.split(separator);
    const trailingDigits = parts.at(-1)?.length ?? 0;
    const separatorCount = parts.length - 1;

    // Valores monetários não usam três casas decimais neste contrato. Uma
    // forma como `R$ 1.234` ou `1,234` representa milhar, mesmo quando a IA
    // omite os centavos. Com uma ou duas casas, o separador é decimal.
    if (
      trailingDigits === 3 &&
      parts.slice(1).every((part) => part.length === 3)
    ) {
      normalized = parts.join("");
    } else if (
      trailingDigits >= 1 &&
      trailingDigits <= 2 &&
      (separatorCount === 1 ||
        parts.slice(1, -1).every((part) => part.length === 3))
    ) {
      normalized = `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? `money:${parsed.toFixed(2)}` : value;
}

function comparableFindingValue(
  finding: {
    category: string;
    evidence: Record<string, unknown>;
  },
  value: unknown,
) {
  const category = finding.category.toLocaleUpperCase("en-US");
  const field =
    typeof finding.evidence.field === "string"
      ? normalizeComparableToken(finding.evidence.field)
      : "";
  const monetary =
    /AMOUNT|TOTAL|PRICE|VALOR|PRE[CÇ]O/u.test(category) ||
    /valor|pre[cç]o|total/u.test(field);
  return monetary ? normalizeComparableMoney(value) : value;
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
  // Dois números não transformam uma dúvida sobre autorização, cadastro ou
  // outro fato ausente em contradição documental. Esses dados só podem ser
  // confirmados fora do conjunto enviado.
  if (EXTERNAL_CONTEXT_PATTERN.test(text)) return null;
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
  const comparableValue = (value: string | number) => {
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `date:${raw}`;
    const localDate = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/,
    );
    if (localDate) {
      const year =
        localDate[3].length === 2 ? `20${localDate[3]}` : localDate[3];
      const month = localDate[2].padStart(2, "0");
      const day = localDate[1].padStart(2, "0");
      return `date:${year}-${month}-${day}`;
    }

    const normalized = raw
      .replace(/^R\$\s*/i, "")
      .replace(/\s+/g, "");
    const monetary = normalized.includes(",")
      ? normalized.replaceAll(".", "").replace(",", ".")
      : normalized;
    if (/^-?\d+(?:\.\d+)?$/.test(monetary)) {
      const parsed = Number(monetary);
      if (Number.isFinite(parsed)) return `number:${parsed.toFixed(2)}`;
    }

    return `text:${normalizeComparableToken(raw)}`;
  };

  const collectComparableValues = (value: unknown, output: Set<string>) => {
    if (typeof value === "number") {
      output.add(comparableValue(value));
      return;
    }
    if (typeof value === "string") {
      const moneyMatches = value.match(MONEY_TOKEN_PATTERN) ?? [];
      const dateMatches = value.match(DATE_TOKEN_PATTERN) ?? [];
      for (const match of [...moneyMatches, ...dateMatches]) {
        output.add(comparableValue(match));
      }
      if (/^(?:R\$\s*)?-?\d+(?:[.,]\d+)?$/i.test(value.trim())) {
        output.add(comparableValue(value));
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        output.add(comparableValue(value));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) collectComparableValues(entry, output);
      return;
    }
    if (value && typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        collectComparableValues(entry, output);
      }
    }
  };

  const expected = new Set(values.map(comparableValue));
  return findings.some((finding) => {
    const actual = new Set<string>();
    collectComparableValues(finding.expectedValue, actual);
    collectComparableValues(finding.actualValue, actual);
    collectComparableValues(finding.evidence, actual);
    return [...expected].every((value) => actual.has(value));
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
  references?: string[];
}>(findings: T[]) {
  const seen = new Set<string>();
  const semanticScopes = new Map<
    string,
    Array<{
      documentGroup: string | null;
      documentRole: string | null;
      lineNumber: number | null;
      pages: Set<number>;
    }>
  >();

  const scopeFor = (finding: T) => {
    const pages = new Set<number>();
    if (typeof finding.evidence.page === "number") {
      pages.add(finding.evidence.page);
    }
    if (Array.isArray(finding.evidence.pages)) {
      for (const page of finding.evidence.pages) {
        if (typeof page === "number") pages.add(page);
      }
    }
    if (Array.isArray(finding.evidence.observations)) {
      for (const observation of finding.evidence.observations) {
        if (
          observation &&
          typeof observation === "object" &&
          "page" in observation &&
          typeof observation.page === "number"
        ) {
          pages.add(observation.page);
        }
      }
    }
    for (const reference of finding.references ?? []) {
      for (const match of reference.matchAll(/p[aá]gina:?(\d+)/giu)) {
        pages.add(Number(match[1]));
      }
    }

    return {
      documentGroup:
        typeof finding.evidence.documentGroup === "string"
          ? normalizeComparableToken(finding.evidence.documentGroup)
          : null,
      documentRole:
        typeof finding.evidence.documentRole === "string"
          ? normalizeComparableToken(finding.evidence.documentRole)
          : null,
      lineNumber:
        finding.noteItemLineNumber ??
        (typeof finding.evidence.lineNumber === "number"
          ? finding.evidence.lineNumber
          : null),
      pages,
    };
  };

  return findings.filter((finding) => {
    const lineNumber =
      finding.noteItemLineNumber ?? finding.evidence.lineNumber ?? null;
    const key = stableJson({
      actualValue: comparableFindingValue(finding, finding.actualValue),
      category: finding.category,
      code:
        finding.expectedValue === null && finding.actualValue === null
          ? null
          : finding.code,
      expectedValue: comparableFindingValue(finding, finding.expectedValue),
      field: finding.evidence.field ?? null,
      lineNumber,
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

    if (finding.expectedValue !== null || finding.actualValue !== null) {
      const semanticKey = stableJson({
        actualValue: comparableFindingValue(finding, finding.actualValue),
        category: finding.category,
        expectedValue: comparableFindingValue(finding, finding.expectedValue),
        field: finding.evidence.field ?? null,
      });
      const scope = scopeFor(finding);
      const previousScopes = semanticScopes.get(semanticKey) ?? [];
      const overlapsPrevious = previousScopes.some((previous) => {
        if (scope.documentGroup !== null && previous.documentGroup !== null) {
          if (previous.documentGroup !== scope.documentGroup) return false;
          if (scope.lineNumber !== null && previous.lineNumber !== null) {
            if (scope.lineNumber === previous.lineNumber) return true;
            const evidenceLayerRoles = new Set([
              "aggregate_payment",
              "supporting_document",
              "summary",
            ]);
            return (
              (scope.documentRole !== null &&
                evidenceLayerRoles.has(scope.documentRole)) ||
              (previous.documentRole !== null &&
                evidenceLayerRoles.has(previous.documentRole))
            );
          }
          return [...scope.pages].some((page) => previous.pages.has(page));
        }
        if (scope.lineNumber !== null && previous.lineNumber !== null) {
          if (previous.lineNumber === scope.lineNumber) return true;
        }
        return false;
      });
      if (overlapsPrevious) return false;
      previousScopes.push(scope);
      semanticScopes.set(semanticKey, previousScopes);
    }
    return true;
  });
}

function resolveFindingDocumentGroup<T extends {
  evidence: Record<string, unknown>;
  noteItemLineNumber: number | null;
}>(finding: T, invoice: HarnessInvoice): T {
  const lineNumber =
    finding.noteItemLineNumber ??
    (typeof finding.evidence.lineNumber === "number"
      ? finding.evidence.lineNumber
      : null);
  const candidateGroups = new Set<string>();
  if (typeof finding.evidence.documentGroup === "string") {
    candidateGroups.add(
      normalizeComparableToken(finding.evidence.documentGroup),
    );
  }
  let documentRole: string | null =
    typeof finding.evidence.documentRole === "string"
      ? normalizeComparableToken(finding.evidence.documentRole)
      : null;
  if (lineNumber !== null) {
    const item = invoice.items.find(
      (candidate) => candidate.lineNumber === lineNumber,
    );
    if (item) {
      if (typeof item.documentRole === "string") {
        documentRole = normalizeComparableToken(item.documentRole);
      }
      for (const group of [
        item.documentGroup,
        ...(item.evidenceObservations ?? []).map(
          (observation) => observation.documentGroup,
        ),
      ]) {
        if (typeof group === "string") {
          candidateGroups.add(normalizeComparableToken(group));
        }
      }
    }
  }

  if (candidateGroups.size === 0 && typeof finding.evidence.page === "number") {
    const page = finding.evidence.page;
    for (const item of invoice.items) {
      for (const observation of item.evidenceObservations ?? []) {
        if (observation.page !== page) continue;
        const group = observation.documentGroup ?? item.documentGroup;
        if (typeof group === "string") {
          candidateGroups.add(normalizeComparableToken(group));
        }
      }
    }
  }
  if (candidateGroups.size !== 1 && documentRole === null) return finding;

  return {
    ...finding,
    evidence: {
      ...finding.evidence,
      ...(candidateGroups.size === 1
        ? { documentGroup: [...candidateGroups][0] }
        : {}),
      ...(documentRole === null ? {} : { documentRole }),
    },
  };
}

function reconcileFindingPrecedence<T extends {
  actualValue: unknown;
  category: string;
  code: string;
  evidence: Record<string, unknown>;
  expectedValue: unknown;
  noteItemLineNumber: number | null;
}>(findings: T[]) {
  const coverageGaps = findings.filter(
    (finding) =>
      finding.code === "COMPOSITE_DETAIL_COVERAGE_GAP" ||
      finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
  );
  const evidenceMismatchLines = new Set(
    findings
      .filter((finding) => finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_"))
      .map(
        (finding) =>
          finding.noteItemLineNumber ??
          (typeof finding.evidence.lineNumber === "number"
            ? finding.evidence.lineNumber
            : null),
      )
      .filter((value): value is number => value !== null),
  );

  return findings.filter((finding) => {
    if (finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_")) {
      const findingGroup =
        typeof finding.evidence.documentGroup === "string"
          ? normalizeComparableToken(finding.evidence.documentGroup)
          : null;
      const hasSameCoverageGap =
        findingGroup !== null &&
        coverageGaps.some((gap) => {
          const gapGroup =
            typeof gap.evidence.documentGroup === "string"
              ? normalizeComparableToken(gap.evidence.documentGroup)
              : null;
          return gapGroup === findingGroup;
        });
      if (hasSameCoverageGap) return false;
    }

    if (finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_")) {
      const findingGroup =
        typeof finding.evidence.documentGroup === "string"
          ? normalizeComparableToken(finding.evidence.documentGroup)
          : null;
      const findingValues = new Set([
        stableJson(finding.expectedValue),
        stableJson(finding.actualValue),
      ]);
      const coveredByDocumentGap = coverageGaps.some((gap) => {
        const gapGroup =
          typeof gap.evidence.documentGroup === "string"
            ? normalizeComparableToken(gap.evidence.documentGroup)
            : null;
        if (findingGroup === null || gapGroup !== findingGroup) return false;
        const gapValues = new Set([
          stableJson(gap.expectedValue),
          stableJson(gap.actualValue),
        ]);
        return (
          findingValues.size === gapValues.size &&
          [...findingValues].every((value) => gapValues.has(value))
        );
      });
      if (coveredByDocumentGap) return false;
    }

    if (finding.code === "TOTAL_MISMATCH" && coverageGaps.length > 0) {
      const selectedLineNumbers = Array.isArray(finding.evidence.selectedLineNumbers)
        ? finding.evidence.selectedLineNumbers.filter(
            (value): value is number => typeof value === "number",
          )
        : [];
      const documentGroups = Array.isArray(finding.evidence.documentGroups)
        ? finding.evidence.documentGroups
            .filter((value): value is string => typeof value === "string")
            .map(normalizeComparableToken)
        : [];

      const overlapsGap = coverageGaps.some((gap) => {
        const gapLineNumber =
          gap.noteItemLineNumber ??
          (typeof gap.evidence.lineNumber === "number"
            ? gap.evidence.lineNumber
            : null);
        const gapGroup =
          typeof gap.evidence.documentGroup === "string"
            ? normalizeComparableToken(gap.evidence.documentGroup)
            : null;

        if (
          gapLineNumber !== null &&
          selectedLineNumbers.includes(gapLineNumber)
        ) {
          return true;
        }
        if (gapGroup !== null && documentGroups.includes(gapGroup)) {
          return true;
        }

        // Um TOTAL_MISMATCH sem localização não pode prevalecer sobre uma
        // lacuna de cobertura, pois não é possível provar que são camadas distintas.
        return selectedLineNumbers.length === 0 && documentGroups.length === 0;
      });
      if (overlapsGap) return false;
    }
    if (finding.code !== "ITEM_ARITHMETIC_MISMATCH") return true;
    const lineNumber =
      finding.noteItemLineNumber ??
      (typeof finding.evidence.lineNumber === "number"
        ? finding.evidence.lineNumber
        : null);
    return lineNumber === null || !evidenceMismatchLines.has(lineNumber);
  });
}

const NAME_VARIATION_PATTERN =
  /(?:benefici[aá]ri|fornecedor|supplier|vendor|nome)[\s\S]{0,100}(?:vari|diverg|diferen|inconsist)|(?:vari|diverg|diferen|inconsist)[\s\S]{0,100}(?:benefici[aá]ri|fornecedor|supplier|vendor|nome)/iu;
const ASSET_ASSOCIATION_PATTERN =
  /\b(?:placa|ve[ií]cul\w*|equipament\w*|frota|m[aá]quin\w*|asset)\b/iu;
const TAX_IDENTIFIER_PATTERN =
  /\b(?:\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[-\s]?\d{2}|\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}|\d{11}|\d{14})\b/gu;

function findingSearchText(finding: HarnessFinding) {
  return normalizeComparableToken(
    [
      finding.code,
      finding.title,
      finding.description,
      finding.category,
      finding.justification,
      JSON.stringify(finding.evidence),
      JSON.stringify(finding.expectedValue),
      JSON.stringify(finding.actualValue),
      finding.references.join(" "),
    ].join(" "),
  );
}

function distinctTaxIdentifiers(value: string) {
  return new Set(
    (value.match(TAX_IDENTIFIER_PATTERN) ?? [])
      .map((candidate) => candidate.replace(/\D/g, ""))
      .filter((candidate) => candidate.length === 11 || candidate.length === 14),
  );
}

/**
 * Remove observações livres que não têm base suficiente para chegar ao
 * diagnóstico do revisor. Regras universais determinísticas não passam por
 * este filtro.
 */
export function filterAiDiscoveryFindings(
  findings: HarnessFinding[],
  workRules: WorkRuleInput[] = [],
) {
  const hasAssetRule = workRules.some((rule) =>
    ASSET_ASSOCIATION_PATTERN.test(
      normalizeComparableToken(
        `${rule.code} ${rule.name} ${rule.category} ${JSON.stringify(rule.configuration)}`,
      ),
    ),
  );

  return findings.filter((finding) => {
    if (finding.source !== "AI_DISCOVERY") return true;
    if (finding.severity === "INFO") return false;

    const text = findingSearchText(finding);
    if (NAME_VARIATION_PATTERN.test(text)) {
      // Abreviação ou variação textual não comprova duas entidades distintas.
      // São necessários dois identificadores fiscais diferentes no próprio
      // conjunto de evidências.
      if (distinctTaxIdentifiers(text).size < 2) return false;
    }

    if (ASSET_ASSOCIATION_PATTERN.test(text) && !hasAssetRule) {
      // No MVP, placa/equipamento só é auditável quando um cadastro ou regra
      // ativa da obra foi realmente fornecido ao Harness.
      return false;
    }

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
  const discoveredFindings = input.aiDiscovery?.findings ?? [];
  const aiFindings = filterAiDiscoveryFindings(
    discoveredFindings,
    input.workRules ?? [],
  );
  // A lacuna de cobertura é um sinal interno que pode impedir um falso
  // TOTAL_MISMATCH, mas não deve virar card de diagnóstico para o revisor.
  const reconciliationSignals = discoveredFindings.filter(
    (finding) =>
      finding.source === "AI_DISCOVERY" &&
      finding.severity === "INFO" &&
      finding.code === "COMPOSITE_DETAIL_COVERAGE_GAP",
  );
  const routedContext = routeContextQuestions(
    input.aiDiscovery?.contextQuestions ?? [],
    [...universal.findings, ...work.findings, ...aiFindings],
  );
  const findings = deduplicateHarnessFindings(
    reconcileFindingPrecedence([
      ...universal.findings,
      ...work.findings,
      ...reconciliationSignals,
      ...aiFindings,
      ...routedContext.promotedFindings,
    ].map((finding) => resolveFindingDocumentGroup(finding, input.invoice))).filter(
      (finding) =>
        finding.code !== "TOTAL_MISMATCH" ||
        input.invoice.itemCoverage?.status === "COMPLETE",
    ),
  ).filter(
    (finding) =>
      finding.source !== "AI_DISCOVERY" || finding.severity !== "INFO",
  );
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

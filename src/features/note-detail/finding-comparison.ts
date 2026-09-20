import {
  formatFindingValue,
  formatReviewerConflictValueCards,
  formatReviewerFindingValueLines,
  inferReviewerDirectedComparison,
  reviewerObservationValue,
} from "@/features/internal-notes/finding-display";

import {
  extractFindingEvidenceObservations,
  findingEvidenceField,
  findingObservationKindLabel,
  extractFindingComparisonValues,
  type FindingEvidenceObservation,
} from "./finding-observations";
import {
  findingComparisonDifference,
  findingComparisonLabels,
} from "./finding-comparison-labels";

export type ReviewerMobileComparisonCard = {
  label: string;
  lines: string[];
  tone: "actual" | "expected" | "neutral";
};

export type ReviewerMobileComparison = {
  cards: ReviewerMobileComparisonCard[];
  difference: string | null;
  hint: string | null;
  mode: "REFERENCE" | "CONFLICT";
};

export type ReviewerFindingComparisonInput = {
  actualValue: unknown;
  affectedItem?: unknown;
  category?: string | null;
  code?: string | null;
  comparisonMode?: "REFERENCE" | "CONFLICT" | null;
  evidence?: unknown;
  expectedValue: unknown;
  observations?: FindingEvidenceObservation[];
  referenceBasis?: string | null;
  rule?: {
    code?: string | null;
    name?: string | null;
  } | null;
  sources?: Array<{ kind: string }>;
  title?: string | null;
};

/**
 * Builds the small comparison model consumed by the mobile Reviewer card.
 * Explicit comparisonMode is authoritative; legacy findings only use a
 * reference when a reference basis/source is present. A conflict never gets
 * an expected-side card or a red/green tone.
 */
export function buildFindingComparison(
  finding: ReviewerFindingComparisonInput,
): ReviewerMobileComparison {
  const mode =
    finding.comparisonMode ??
    (finding.referenceBasis ||
    finding.sources?.some((source) => source.kind === "reference")
      ? "REFERENCE"
      : "CONFLICT");
  const identity = {
    category: finding.category,
    code: finding.code,
    field: findingEvidenceField(finding.evidence),
    title: finding.title,
  };

  if (mode === "CONFLICT") {
    const observations =
      finding.observations ??
      extractFindingEvidenceObservations(finding.evidence);
    const explicitValues = extractFindingComparisonValues(finding.evidence);
    const observationSources = observations.map((observation) => ({
      label: observation.label || findingObservationKindLabel(observation.kind),
      value: reviewerObservationValue(observation, identity),
    }));
    const observationCards = formatReviewerConflictValueCards(
      null,
      null,
      identity,
      observationSources,
    );
    const cards = formatReviewerConflictValueCards(
      finding.actualValue,
      finding.expectedValue,
      identity,
      explicitValues.length ? explicitValues : observationSources,
    ).map((card) => ({
      ...card,
      tone: "neutral" as const,
    }));
    // Direction must come from document observations when they exist. Derived
    // labels such as "soma bruta / detalhamento líquido" are calculations,
    // not two independent sources corroborating an expected value.
    const directed = inferReviewerDirectedComparison(
      observationCards.length ? observationCards : cards,
      identity,
    );

    if (directed) {
      return {
        cards: [
          {
            label: "Encontrado",
            lines: directed.actual.lines,
            tone: "actual",
          },
          {
            label: "Esperado",
            lines: directed.expected.lines,
            tone: "expected",
          },
        ],
        difference: directed.difference,
        hint: null,
        mode: "REFERENCE",
      };
    }

    return {
      cards,
      difference: null,
      hint: cards.length
        ? "Sem referência comprovada para escolher um valor como correto."
        : null,
      mode,
    };
  }

  const labels = findingComparisonLabels(finding);
  const hasMeaningfulComparison =
    finding.actualValue !== null &&
    finding.expectedValue !== null &&
    formatFindingValue(finding.actualValue) !==
      formatFindingValue(finding.expectedValue);
  if (!hasMeaningfulComparison) {
    return { cards: [], difference: null, hint: null, mode };
  }

  return {
    cards: [
      {
        label: labels.actual,
        lines: formatReviewerFindingValueLines(
          formatFindingValue(finding.actualValue, "Não informado"),
          identity,
        ),
        tone: "actual",
      },
      {
        label: labels.expected,
        lines: formatReviewerFindingValueLines(
          formatFindingValue(
            finding.expectedValue,
            "Sem referência comparável",
          ),
          identity,
        ),
        tone: "expected",
      },
    ],
    difference: findingComparisonDifference(finding),
    hint: null,
    mode,
  };
}

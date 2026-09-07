import {
  formatFindingValue,
  formatReviewerConflictValueCards,
  formatReviewerFindingValueLines,
  reviewerObservationValue,
} from "@/features/internal-notes/finding-display";

import type { NoteDetailFinding } from "./data";
import {
  extractFindingEvidenceObservations,
  findingEvidenceField,
  findingObservationKindLabel,
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

/**
 * Builds the small comparison model consumed by the mobile Reviewer card.
 * Explicit comparisonMode is authoritative; legacy findings only use a
 * reference when a reference basis/source is present. A conflict never gets
 * an expected-side card or a red/green tone.
 */
export function buildReviewerMobileComparison(
  finding: NoteDetailFinding,
): ReviewerMobileComparison {
  const mode =
    finding.comparisonMode ??
    (finding.referenceBasis ||
    finding.sources.some((source) => source.kind === "reference")
      ? "REFERENCE"
      : "CONFLICT");
  const identity = {
    category: finding.category,
    code: finding.code,
    field: findingEvidenceField(finding.evidence),
    title: finding.title,
  };

  if (mode === "CONFLICT") {
    const observations = extractFindingEvidenceObservations(finding.evidence);
    const cards = formatReviewerConflictValueCards(
      finding.actualValue,
      finding.expectedValue,
      identity,
      observations.slice(0, 4).map((observation) => ({
        label: findingObservationKindLabel(observation.kind),
        value: reviewerObservationValue(observation, identity),
      })),
    ).map((card) => ({
      ...card,
      tone: "neutral" as const,
    }));

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

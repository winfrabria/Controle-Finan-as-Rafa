import "server-only";

import { sanitizeReviewerText } from "@/features/note-detail/data/reviewer-data-policy";
import type { ReviewerDashboardNote } from "@/features/workspace-ui/reviewer-dashboard-types";

import type { NoteListItem } from "./note-list-query";

function safeNullableText(value: string | null) {
  return value === null ? null : sanitizeReviewerText(value);
}

export function sanitizeReviewerNoteListItem(item: NoteListItem): NoteListItem {
  return {
    ...item,
    processingFailureMessage: safeNullableText(item.processingFailureMessage ?? null),
    assurance: item.assurance ? { ...item.assurance, reason: sanitizeReviewerText(item.assurance.reason) } : null,
    findings: item.findings.map((finding) => ({
      ...finding,
      actualValue: safeNullableText(finding.actualValue),
      category: sanitizeReviewerText(finding.category),
      description: sanitizeReviewerText(finding.description),
      evidence: safeNullableText(finding.evidence),
      evidenceDetails: finding.evidenceDetails.map((part) => ({
        label: sanitizeReviewerText(part.label),
        value: sanitizeReviewerText(part.value),
      })),
      evidenceLocations: finding.evidenceLocations?.map((location) => ({
        ...location,
        kind: sanitizeReviewerText(location.kind),
        label: safeNullableText(location.label),
        text: safeNullableText(location.text),
        value: safeNullableText(location.value ?? null),
      })) ?? [],
      expectedValue: safeNullableText(finding.expectedValue),
      justification: sanitizeReviewerText(finding.justification),
      title: sanitizeReviewerText(finding.title),
    })),
    primaryFinding: safeNullableText(item.primaryFinding),
  };
}

export function sanitizeReviewerDashboardNote(
  item: ReviewerDashboardNote,
): ReviewerDashboardNote {
  return {
    ...item,
    reasons: item.reasons.map(sanitizeReviewerText),
  };
}

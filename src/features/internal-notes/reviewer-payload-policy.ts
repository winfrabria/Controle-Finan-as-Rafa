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

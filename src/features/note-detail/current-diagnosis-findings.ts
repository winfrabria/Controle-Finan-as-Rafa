import { findingComparisonMetadata } from "@/features/internal-notes/finding-display";
import { requiresSourceReview } from "@/lib/audit-harness/source-review";

type DiagnosisFinding = {
  code?: string | null;
  evidence?: unknown;
  status: string;
};

/** Historical findings remain stored, but are not part of the active diagnosis. */
export function currentDiagnosisFindings<T extends DiagnosisFinding>(findings: readonly T[]): T[] {
  return findings.filter((finding) => finding.status === "OPEN");
}

/**
 * Partial breakdown findings created by older rules are retained for ADMIN
 * traceability, but they must not classify a reviewer note as suspicious.
 * The current hierarchy rule only emits this finding when the detail set is
 * explicitly complete; a legacy conflict awaiting source review proves no
 * mismatch and is therefore excluded from the active reviewer diagnosis.
 */
export function currentReviewerDiagnosisFindings<T extends DiagnosisFinding>(
  findings: readonly T[],
): T[] {
  return currentDiagnosisFindings(findings).filter((finding) => {
    if (!finding.code?.startsWith("DOCUMENT_BREAKDOWN_MISMATCH_")) return true;
    const comparison = findingComparisonMetadata(finding.evidence, null);
    return !(
      comparison.comparisonMode === "CONFLICT" &&
      comparison.referenceBasis === null &&
      requiresSourceReview(finding.evidence)
    );
  });
}

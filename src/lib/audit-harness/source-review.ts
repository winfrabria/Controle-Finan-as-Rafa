import type { HarnessFinding } from "./contracts";

export function requiresSourceReview(evidence: unknown): boolean {
  return evidence !== null && typeof evidence === "object" &&
    "requiresSourceReview" in evidence && evidence.requiresSourceReview === true;
}

/** A deterministic comparison is not independent proof of an AI-read source. */
export function markFindingsForSourceReview(findings: HarnessFinding[], extractionLimited: boolean) {
  if (!extractionLimited) return findings;
  return findings.map((finding) => {
    // Exact original-byte identity does not depend on extracted values or pages.
    const originalBytesMatch = finding.source === "UNIVERSAL_RULE" &&
      finding.code === "DUPLICATE_ATTACHMENT" && finding.evidence.matchBasis === "FILE_SHA256";
    if (originalBytesMatch || finding.source === "AI_VERIFICATION" || finding.severity === "INFO") return finding;
    return { ...finding, evidence: { ...finding.evidence, requiresSourceReview: true } };
  });
}

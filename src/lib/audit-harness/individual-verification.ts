import { hasTracedHypothesisPair, hasTracedMonetaryPair } from "./finding-source-observations";
import { isSupportedFinding } from "./decision-matrix";
import {
  explicitlyConfirmedVerificationFindings, validateVerificationCoverage,
  type VerificationResponse,
} from "./verification";

type VerificationInput = Parameters<typeof validateVerificationCoverage>[0];

/** Whole-document coverage and a located contradiction are different claims.
 * Partial coverage can retain ONLY an independently confirmed documentary
 * conflict with its own complete hypothesis or monetary-pair trace. It never proves PASS,
 * authorization, identity, completeness, or the absence of other problems. */
export function individuallyConfirmedVerificationFindings(input: VerificationInput, options: { requireIndividualTrace?: boolean } = {}) {
  const coverage = validateVerificationCoverage(input);
  if (!Number.isSafeInteger(input.expectedPageCount) || (input.expectedPageCount ?? 0) < 1) return [];
  const invalidKeys = new Set([...coverage.unknownKeys, ...coverage.duplicateKeys, ...coverage.mismatchedCheckKeys,
    ...coverage.invalidEvidenceCheckKeys, ...coverage.evidenceMissingCheckKeys, ...coverage.invalidComparisonCheckKeys]);
  const invalidCodes = new Set([...coverage.invalidFindingPages, ...coverage.invalidConfirmationCodes,
    ...coverage.invalidFindingEvidenceCodes, ...coverage.unlinkedFindingCodes]);
  const accepted = new Set<VerificationResponse["findings"][number]>(coverage.complete && !options.requireIndividualTrace
    ? explicitlyConfirmedVerificationFindings(input.initialFindings ?? [], input.response.findings) : []);
  for (const expected of input.expectedChecks) {
    if (expected.amountPair && !invalidKeys.has(expected.key)) {
      const check = input.response.checks.find(candidate => candidate.key === expected.key);
      const candidates = input.response.findings.filter(finding => finding.code === check?.findingCode);
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const left = check?.comparison?.leftEvidenceIndex, right = check?.comparison?.rightEvidenceIndex;
      if (check?.state === "FINDING" && check.comparison?.outcome === "CONFLICT" &&
        left != null && right != null && check.evidence[left] && check.evidence[right] && candidate &&
        !invalidCodes.has(candidate.code) && isSupportedFinding(candidate) && candidate.confirmsInitialFindingCode === null &&
        candidate.evidence.claimScope === "DOCUMENT_CONTENT" && candidate.comparisonMode === "CONFLICT" &&
        candidate.expectedValue == null && candidate.referenceBasis == null && candidate.noteItemLineNumber === expected.lineNumber &&
        hasTracedMonetaryPair(candidate.evidence, [check.evidence[left], check.evidence[right]])) accepted.add(candidate);
    }
    const hypothesis = expected.hypothesisReview;
    if (!hypothesis || invalidKeys.has(expected.key)) continue;
    const initial = input.initialFindings?.[hypothesis.initialFindingIndex];
    const check = input.response.checks.find(candidate => candidate.key === expected.key);
    if (!initial || initial.code !== hypothesis.code || initial.evidence.claimScope !== "DOCUMENT_CONTENT" ||
      initial.comparisonMode !== "CONFLICT" || initial.expectedValue != null || initial.referenceBasis != null ||
      !check || check.state !== "FINDING" || check.comparison?.outcome !== "CONFLICT") continue;
    if (!hasTracedHypothesisPair(initial.evidence, check.evidence, check.comparison.leftEvidenceIndex ?? -1,
      check.comparison.rightEvidenceIndex ?? -1, true)) continue;
    for (const finding of explicitlyConfirmedVerificationFindings([initial], input.response.findings)) {
      if (finding.code !== check.findingCode || invalidCodes.has(finding.code) ||
        finding.evidence.claimScope !== "DOCUMENT_CONTENT" || finding.comparisonMode !== "CONFLICT" ||
        finding.expectedValue != null || finding.referenceBasis != null) continue;
      accepted.add(finding);
    }
  }
  return [...accepted];
}

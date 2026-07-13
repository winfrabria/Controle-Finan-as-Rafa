import type { HarnessFinding, HarnessInvoice } from "./contracts";
import { HARNESS_MODEL, HARNESS_VERSIONS } from "./versions";

export const AUDIT_POLICY = {
  version: HARNESS_VERSIONS.policy,
  model: HARNESS_MODEL,
  defaultReasoningEffort: "high",
  readFailureThreshold: 0.6,
  supportedFindingThreshold: 0.65,
  xhighTriggers: {
    highValueAmount: 50_000,
    lowReadableConfidenceMaximum: 0.75,
  },
  alwaysSuspiciousCategories: ["ALCOHOL", "PERSONAL_HYGIENE"],
} as const;

export type ReasoningSelection = {
  effort: "high" | "xhigh";
  triggers: string[];
};

export function selectReasoningEffort(
  invoice: HarnessInvoice,
  findings: HarnessFinding[],
): ReasoningSelection {
  const triggers: string[] = [];
  const total = invoice.totalAmount === null ? null : Number(invoice.totalAmount);

  if (total !== null && total >= AUDIT_POLICY.xhighTriggers.highValueAmount) {
    triggers.push("HIGH_VALUE");
  }
  if (findings.some((finding) => finding.severity === "CRITICAL")) {
    triggers.push("CRITICAL_FINDING");
  }
  if (
    invoice.readConfidence >= AUDIT_POLICY.readFailureThreshold &&
    invoice.readConfidence <= AUDIT_POLICY.xhighTriggers.lowReadableConfidenceMaximum
  ) {
    triggers.push("LOW_BUT_READABLE_CONFIDENCE");
  }
  if (invoice.warnings.length >= 3) {
    triggers.push("MULTIPLE_EXTRACTION_WARNINGS");
  }

  return { effort: triggers.length > 0 ? "xhigh" : "high", triggers };
}

export function isReadFailure(invoice: HarnessInvoice) {
  if (invoice.readConfidence < AUDIT_POLICY.readFailureThreshold) return true;

  const hasMinimumIdentity = Boolean(
    invoice.supplierName || invoice.supplierTaxId || invoice.documentNumber,
  );
  const hasFinancialContent = Boolean(invoice.totalAmount || invoice.items.length);
  return !hasMinimumIdentity || !hasFinancialContent;
}


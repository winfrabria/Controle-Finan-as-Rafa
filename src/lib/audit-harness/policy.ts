import type { HarnessFinding, HarnessInvoice } from "./contracts";
import { HARNESS_MODEL, HARNESS_VERSIONS } from "./versions";

export const AUDIT_POLICY = {
  version: HARNESS_VERSIONS.policy,
  model: HARNESS_MODEL,
  defaultReasoningEffort: "max",
  readFailureThreshold: 0.6,
  supportedFindingThreshold: 0.65,
  xhighTriggers: {
    highValueAmount: 50_000,
    lowReadableConfidenceMaximum: 0.75,
  },
  alwaysSuspiciousCategories: ["ALCOHOL", "PERSONAL_HYGIENE"],
} as const;

export type ReasoningSelection = {
  effort: "high" | "max" | "xhigh";
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

  return { effort: AUDIT_POLICY.defaultReasoningEffort, triggers };
}

export function isReadFailure(invoice: HarnessInvoice) {
  if (invoice.readConfidence < AUDIT_POLICY.readFailureThreshold) return true;

  const hasMinimumIdentity = Boolean(
    invoice.supplierName || invoice.supplierTaxId || invoice.documentNumber,
  );
  const hasFinancialContent = invoice.totalAmount !== null || invoice.items.length > 0;
  if (!hasFinancialContent) return true;
  if (hasMinimumIdentity) return false;

  // Reimbursements and other composite submissions legitimately contain
  // several receipts/suppliers instead of one invoice identity. They must be
  // audited as a whole when the extraction is otherwise readable.
  const compositeDocument = [...invoice.warnings, invoice.markdown].some((value) =>
    /reembolso|reimbursement|múltiplos? fornecedores|vários fornecedores|multiple suppliers|comprovantes?|prestação de contas|expense report/i.test(value),
  );
  return !compositeDocument;
}

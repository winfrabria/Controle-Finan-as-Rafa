import type { HarnessFinding, HarnessInvoice } from "./contracts";
import { isOcrFallbackExtraction } from "@/lib/integrations/openrouter/extraction-contract";
import { HARNESS_MODEL, HARNESS_VERSIONS } from "./versions";

export const AUDIT_POLICY = {
  version: HARNESS_VERSIONS.policy,
  model: HARNESS_MODEL,
  fallbackModel: HARNESS_MODEL,
  defaultReasoningEffort: "high",
  fallbackReasoningEffort: "high",
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
  const ocrFallback = isOcrFallbackExtraction(invoice);
  const ocrHasFinancialSignal =
    ocrFallback &&
    invoice.markdown.length >= 120 &&
    /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b/.test(invoice.markdown);

  const hasMinimumIdentity = Boolean(
    invoice.supplierName || invoice.supplierTaxId || invoice.documentNumber,
  );
  const hasFinancialContent =
    invoice.totalAmount !== null || invoice.items.length > 0 || ocrHasFinancialSignal;
  if (!hasFinancialContent) return true;

  // Reimbursements and other composite submissions legitimately contain
  // several receipts/suppliers instead of one invoice identity. They must be
  // audited as a whole when the extraction is otherwise readable.
  const compositeDocument = [...invoice.warnings, invoice.markdown].some((value) =>
    /reembolso|reimbursement|múltiplos? fornecedores|vários fornecedores|multiple suppliers|comprovantes?|prestação de contas|expense report/i.test(value),
  );

  // Provider confidence is useful telemetry, but it is not sufficient on its
  // own to discard a materially complete extraction. Some multimodal models
  // return zero when a composite document has no single supplier identity,
  // even after reading every page, reconciling the total and extracting many
  // individual receipts. Require independent structural evidence before a
  // low-confidence result can continue to audit.
  const pricedItems = invoice.items.filter(
    (item) => item.totalAmount !== null || item.unitPrice !== null,
  ).length;
  const hasRichStructuredEvidence =
    invoice.markdown.length >= 500 &&
    invoice.items.length >= 5 &&
    pricedItems >= 3 &&
    (invoice.totalAmount !== null || hasMinimumIdentity);
  const hasCompositeEvidence =
    compositeDocument &&
    invoice.markdown.length >= 240 &&
    invoice.items.length >= 3 &&
    pricedItems >= 3 &&
    invoice.totalAmount !== null;

  if (
    invoice.readConfidence < AUDIT_POLICY.readFailureThreshold &&
    !hasRichStructuredEvidence &&
    !hasCompositeEvidence
  ) {
    return true;
  }
  if (hasMinimumIdentity || ocrFallback || hasRichStructuredEvidence) return false;

  return !compositeDocument;
}

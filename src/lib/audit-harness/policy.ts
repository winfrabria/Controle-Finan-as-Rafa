import type { HarnessFinding, HarnessInvoice } from "./contracts";
import { INVALID_DOCUMENT_DATE_WARNING, isOcrFallbackExtraction } from "@/lib/integrations/openrouter/extraction-contract";
import { isValidIsoCalendarDate } from "@/lib/calendar-date";
import {
  HARNESS_FALLBACK_MODEL,
  HARNESS_MODEL,
  HARNESS_VERSIONS,
} from "./versions";

export const AUDIT_POLICY = {
  version: HARNESS_VERSIONS.policy,
  model: HARNESS_MODEL,
  fallbackModel: HARNESS_FALLBACK_MODEL,
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

  return {
    effort: triggers.length > 0 ? "xhigh" : AUDIT_POLICY.defaultReasoningEffort,
    triggers,
  };
}

function hasInvalidExplicitTotalLayer(invoice: HarnessInvoice) {
  if (invoice.totalAmount === null || invoice.items.length === 0) return false;
  const hasExplicitLayer = invoice.items.some(
    (item) => item.countsTowardDocumentTotal !== undefined,
  );
  return (
    hasExplicitLayer &&
    !invoice.items.some((item) => item.countsTowardDocumentTotal === true)
  );
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
  const hasReadableText =
    invoice.readConfidence >= AUDIT_POLICY.readFailureThreshold &&
    invoice.markdown.trim().length >= 40 &&
    !/nenhum conte[uú]do textual confi[aá]vel foi extra[ií]do/i.test(
      invoice.markdown,
    );
  if (!hasFinancialContent && !hasReadableText) return true;

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
    !hasCompositeEvidence &&
    !hasReadableText
  ) {
    return true;
  }
  if (
    hasMinimumIdentity ||
    ocrFallback ||
    hasRichStructuredEvidence ||
    hasReadableText
  ) {
    return false;
  }

  return !compositeDocument;
}

/**
 * A readable document may still be insufficient for a conclusive audit. This
 * is not a read failure: it is completed as information insufficient, while
 * objective findings supported by the document remain eligible to win.
 */
export function hasUncertainSupportCoverage(invoice: HarnessInvoice) {
  if (invoice.supportCoverage?.status === "PARTIAL") return true;
  const requiresSupportCoverage =
    invoice.documentKind === "COMPOSITE" ||
    invoice.documentKind === "REIMBURSEMENT" ||
    invoice.items.some((item) => item.documentRole === "AGGREGATE_PAYMENT");
  return requiresSupportCoverage && invoice.supportCoverage?.status !== "COMPLETE";
}

export function hasInsufficientAuditBasis(invoice: HarnessInvoice) {
  if (isOcrFallbackExtraction(invoice)) return true;
  if (hasInvalidExplicitTotalLayer(invoice)) return true;
  if (hasUncertainSupportCoverage(invoice)) return true;
  if (
    invoice.warnings.includes(INVALID_DOCUMENT_DATE_WARNING) ||
    (invoice.issuedAt !== null && !isValidIsoCalendarDate(invoice.issuedAt)) ||
    invoice.items.some((item) => item.evidenceObservations?.some(
      (observation) => observation.date !== null && !isValidIsoCalendarDate(observation.date),
    ))
  ) return true;

  const requiresItemCoverage =
    invoice.documentKind === "FISCAL_INVOICE" ||
    invoice.documentKind === "REIMBURSEMENT" ||
    invoice.documentKind === "COMPOSITE";
  if (
    requiresItemCoverage &&
    (invoice.itemCoverage?.status !== "COMPLETE" || invoice.items.length === 0)
  ) {
    return true;
  }

  if (invoice.documentKind === "OTHER") {
    return (
      invoice.totalAmount === null &&
      invoice.items.length === 0 &&
      !invoice.documentNumber &&
      !invoice.supplierName
    );
  }

  if (invoice.documentKind === "PAYMENT_PROOF") {
    return invoice.totalAmount === null && invoice.items.length === 0;
  }

  return false;
}

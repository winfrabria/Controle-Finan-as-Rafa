import type { HarnessFinding, HarnessInvoice } from "./contracts";
import type { InvoiceExtraction } from "../integrations/openrouter/extraction-contract";

/** A locator index, not a second copy of the first reader's asserted facts.
 * Preserve the original extraction in storage; only the verifier transport is
 * changed. Free text, values, dates and entity labels must be read from the file. */
export function verificationSourceIndex(invoice: HarnessInvoice & { pageCoverage?: InvoiceExtraction["pageCoverage"] }) {
  return {
    items: invoice.items.map(item => ({
      lineNumber: item.lineNumber,
      sourcePage: item.sourcePage,
      sourceKind: item.sourceKind,
      documentRole: item.documentRole,
      parentLineNumber: item.parentLineNumber,
      evidenceObservations: (item.evidenceObservations ?? []).map(source => ({ kind: source.kind, page: source.page })),
    })),
    documentObservations: (invoice.documentObservations ?? []).map(source => ({ kind: source.kind, page: source.page })),
    pageInventory: (invoice.pageCoverage ?? []).map(page => ({ page: page.page,
      sources: page.sources.map(source => ({ kind: source.kind, count: source.count })) })),
  };
}

/** Exact discovery confirmation still needs its original hypothesis. Local
 * comparisons do not: keep their keys for routing, not their alleged values.
 * Preserve positions because hypothesisReview uses the original array index. */
export function verificationHypothesisTransport(findings: HarnessFinding[]) {
  return findings.map(finding => finding.source === "AI_DISCOVERY" ? finding : {
    code: finding.code, source: finding.source, category: finding.category,
    noteItemLineNumber: finding.noteItemLineNumber,
  });
}

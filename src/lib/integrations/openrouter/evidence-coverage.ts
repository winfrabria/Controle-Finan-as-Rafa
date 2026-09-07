import type { InvoiceExtraction } from "./extraction-contract";

export type EvidenceCoverageLimitation = { diagnostic: string; message: string; details: Record<string, unknown> };

/** Cross-check two representations. This is NOT independent visual verification. */
export function getEvidenceCoverageLimitation(
  invoice: InvoiceExtraction,
  expectedPageCount?: number | null,
): EvidenceCoverageLimitation | null {
  const pages = invoice.pageCoverage;
  const required = (expectedPageCount ?? 0) > 1 ||
    (expectedPageCount != null && ["COMPOSITE", "REIMBURSEMENT"].includes(invoice.documentKind));
  const fail = (diagnostic: string, details: Record<string, unknown> = {}): EvidenceCoverageLimitation => ({
    diagnostic,
    message: "A leitura dos comprovantes e das instruções do formulário não foi integralmente comprovada.",
    details,
  });
  if (!pages?.length) return required ? fail("evidence-page-inventory-missing") : null;
  const pageNumbers = pages.map(p => p.page);
  if (new Set(pageNumbers).size !== pages.length ||
    (expectedPageCount != null && (pages.length !== expectedPageCount ||
      pageNumbers.some(p => p > expectedPageCount)))) {
    return fail("evidence-page-inventory-inconsistent", { expectedPageCount, pageNumbers });
  }
  for (const page of pages) {
    if (!page.complete || !page.fieldsReviewed || page.requirementScope === "UNKNOWN") {
      return fail("evidence-page-review-incomplete", { page: page.page });
    }
    if (new Set(page.sources.map(s => s.kind)).size !== page.sources.length) {
      return fail("evidence-source-inventory-inconsistent", { page: page.page });
    }
    for (const source of page.sources) {
      const observations = invoice.items.flatMap(item => item.evidenceObservations)
        .filter(o => o.page === page.page && o.kind === source.kind);
      const distinct = new Set(observations.map(o => JSON.stringify([o.documentGroup, o.label, o.amount, o.date, o.text])));
      if (distinct.size < source.count) {
        return fail("evidence-source-not-extracted", { page: page.page, kind: source.kind,
          expectedSources: source.count, extractedSources: distinct.size });
      }
    }
    if (["ALL_FIELDS", "SPECIFIC_FIELDS"].includes(page.requirementScope)) {
      const checks = invoice.requiredFieldChecks.filter(c => c.page === page.page);
      if (!page.requirementEvidence || checks.length === 0 ||
        !checks.some(c => c.requiredByDocument && c.requirementBasis === "EXPLICIT_DOCUMENT" && c.requirementEvidence) ||
        (page.requirementScope === "ALL_FIELDS" && checks.some(c =>
          !c.requiredByDocument || c.requirementBasis !== "EXPLICIT_DOCUMENT" || !c.requirementEvidence))) {
        return fail("evidence-required-instruction-not-applied", { page: page.page });
      }
    }
  }
  const knownPages = new Set(pageNumbers);
  if (invoice.items.some(i => (i.sourcePage !== null && !knownPages.has(i.sourcePage)) ||
    i.evidenceObservations.some(o => o.page !== null && !knownPages.has(o.page)))) {
    return fail("evidence-source-page-outside-inventory");
  }
  for (const observation of invoice.items.flatMap(i => i.evidenceObservations)) {
    if (observation.page === null || !pages.find(p => p.page === observation.page)?.sources.some(s => s.kind === observation.kind)) {
      return fail("evidence-source-missing-from-inventory", { page: observation.page, kind: observation.kind });
    }
  }
  return null;
}

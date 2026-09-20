import type { InvoiceExtraction } from "./extraction-contract";
import { inferredAdjustmentScope, observationQuoteConflict, quotedDatePurpose,
  untracedObservationClaim } from "./source-value-consistency";

export type EvidenceCoverageLimitation = { diagnostic: string; message: string; details: Record<string, unknown> };

export type ContextOnlyCoverageGap = { page: number; kind: "OTHER"; expectedSources: number; extractedSources: number };
type EvidenceSourceKind = NonNullable<InvoiceExtraction["pageCoverage"]>[number]["sources"][number]["kind"];
export type EvidenceInventoryCorrection = { page: number; kind: EvidenceSourceKind;
  declaredCount: number; extractedCount: number };
export type SourceProvenanceCorrection = {
  origin: "PRIMARY" | "OBSERVATION";
  lineNumber: number | null;
  sourceKind: string;
  sourcePage: number | null;
  field: "sourceDate" | "date" | "amount";
  action: "REMOVED_UNTRACED_VALUE";
};

/** A scalar absent from its own quote is not source data. Secondary
 * observations may safely lose an unsupported amount/date while preserving
 * the original excerpt for audit. Primary financial totals remain untouched
 * and still trigger the quality gate because removing them would change the
 * economic layer of the document. */
export function reconcileUntracedSourceClaims(
  invoice: InvoiceExtraction,
  options: { preservePrimaryDates?: boolean } = {},
) {
  const corrections: SourceProvenanceCorrection[] = [];
  const observation = <T extends InvoiceExtraction["items"][number]["evidenceObservations"][number]>(
    source: T,
    lineNumber: number | null,
  ): T => {
    const amountUntraced = source.amount !== null &&
      untracedObservationClaim({ amount: source.amount, date: null, text: source.text,
        amountScope: source.amountScope }) === "amount";
    const dateUntraced = source.date !== null &&
      untracedObservationClaim({ amount: null, date: source.date, text: source.text,
        amountScope: source.amountScope }) === "date";
    if (!amountUntraced && !dateUntraced) return source;
    if (amountUntraced) corrections.push({ origin: "OBSERVATION", lineNumber, sourceKind: source.kind,
      sourcePage: source.page ?? null, field: "amount", action: "REMOVED_UNTRACED_VALUE" });
    if (dateUntraced) corrections.push({ origin: "OBSERVATION", lineNumber, sourceKind: source.kind,
      sourcePage: source.page ?? null, field: "date", action: "REMOVED_UNTRACED_VALUE" });
    return { ...source, ...(amountUntraced ? { amount: null } : {}), ...(dateUntraced ? { date: null } : {}) };
  };
  const items = invoice.items.map(item => {
    const evidenceObservations = item.evidenceObservations.map(source => observation(source, item.lineNumber));
    const changedObservations = evidenceObservations.some((source, index) => source !== item.evidenceObservations[index]);
    const removableSupportAmount = item.countsTowardDocumentTotal === false && item.sourceKind !== "FISCAL_LINE" &&
      item.totalAmount !== null && untracedObservationClaim({ amount: item.totalAmount, date: null,
        text: item.sourceText ?? null, amountScope: inferredAdjustmentScope(item.totalAmount,
          `${item.description} ${item.sourceText ?? ""}`) }) === "amount";
    const removablePrimaryDate = !options.preservePrimaryDates && item.sourceDate && item.sourceKind &&
      item.sourceKind !== "UNKNOWN" &&
      untracedObservationClaim({ amount: null, date: item.sourceDate, text: item.sourceText ?? null }) === "date";
    if (!removableSupportAmount && !removablePrimaryDate) {
      return changedObservations ? { ...item, evidenceObservations } : item;
    }
    if (removableSupportAmount) corrections.push({ origin: "PRIMARY", lineNumber: item.lineNumber,
      sourceKind: item.sourceKind ?? "UNKNOWN", sourcePage: item.sourcePage ?? null,
      field: "amount", action: "REMOVED_UNTRACED_VALUE" });
    if (removablePrimaryDate) corrections.push({ origin: "PRIMARY", lineNumber: item.lineNumber,
      sourceKind: item.sourceKind!, sourcePage: item.sourcePage ?? null,
      field: "sourceDate", action: "REMOVED_UNTRACED_VALUE" });
    return { ...item, ...(removableSupportAmount ? { totalAmount: null, arithmeticVerified: false } : {}),
      ...(removablePrimaryDate ? { sourceDate: null } : {}), evidenceObservations };
  });
  const documentObservations = invoice.documentObservations?.map(source => observation(source, null));
  return { data: corrections.length ? { ...invoice, items, ...(documentObservations ? { documentObservations } : {}) } : invoice,
    corrections };
}

/** Reconcile only sources that are already present as unique, located and
 * traceable evidence. This never creates an item, value or date; a missing
 * fiscal row or an untraced/duplicated observation still requires rereading. */
export function reconcileEvidenceInventory(invoice: InvoiceExtraction) {
  let data = invoice;
  const corrections: EvidenceInventoryCorrection[] = [];
  for (const page of invoice.pageCoverage ?? []) {
    const source = page.sources.find(entry => entry.kind === "FISCAL_LINE");
    const rows = invoice.items.filter(item => item.sourceKind === "FISCAL_LINE" && item.sourcePage === page.page);
    const identities = new Set(rows.map(item => JSON.stringify([
      item.lineNumber, item.description, item.sourceText, item.totalAmount,
    ])));
    if (source && rows.length > source.count && identities.size === rows.length && rows.every(item =>
      item.sourceText && item.totalAmount !== null &&
      !untracedObservationClaim({ amount: item.totalAmount, date: null, text: item.sourceText }))) {
      if (data === invoice) data = structuredClone(invoice);
      const targetPage = data.pageCoverage!.find(entry => entry.page === page.page)!;
      targetPage.sources.find(entry => entry.kind === "FISCAL_LINE")!.count = rows.length;
      corrections.push({ page: page.page, kind: "FISCAL_LINE", declaredCount: source.count, extractedCount: rows.length });
    }
    const observations = [...invoice.items.flatMap(item => item.evidenceObservations), ...(invoice.documentObservations ?? [])]
      .filter(observation => observation.page === page.page);
    for (const kind of new Set(observations.map(observation => observation.kind))) {
      const sources = observations.filter(observation => observation.kind === kind);
      const identities = new Set(sources.map(observation => JSON.stringify([
        observation.documentGroup, observation.label, observation.amount, observation.date, observation.text,
      ])));
      const safelyTraceable = identities.size === sources.length && sources.every(observation =>
        Boolean(observation.text?.trim()) && untracedObservationClaim(observation) === null &&
        // OTHER may carry a quoted contextual date. It remains non-financial:
        // an amount would need a concrete source kind before entering inventory.
        (kind !== "OTHER" || (observation.amountScope === "CONTEXT" && observation.amount === null)));
      const declared = page.sources.find(entry => entry.kind === kind)?.count ?? 0;
      if (!safelyTraceable || sources.length <= declared) continue;
      if (data === invoice) data = structuredClone(invoice);
      const targetPage = data.pageCoverage!.find(entry => entry.page === page.page)!;
      const targetSource = targetPage.sources.find(entry => entry.kind === kind);
      if (targetSource) targetSource.count = sources.length;
      else targetPage.sources.push({ kind, count: sources.length });
      corrections.push({ page: page.page, kind, declaredCount: declared, extractedCount: sources.length });
    }
  }
  return { data, corrections };
}

/** A contextual inventory gap may permit provisional discovery, never complete coverage.
 * The projection below is only a check of the remaining sources; it is not an
 * extraction repair and must never replace the original invoice or inventory. */
export function getContextOnlyCoverageGaps(invoice: InvoiceExtraction, expectedPageCount: number | null | undefined) {
  if (!expectedPageCount || expectedPageCount < 2 || invoice.itemCoverage.status !== "COMPLETE" ||
    invoice.itemCoverage.missingLineNumbers.length > 0 || !invoice.pageCoverage?.length || invoice.items.length === 0 ||
    invoice.items.some(item => !item.sourceKind || item.sourceKind === "UNKNOWN" || item.sourcePage === null || !item.sourceText)) return null;
  const originalLimitation = getEvidenceCoverageLimitation(invoice, expectedPageCount);
  if (originalLimitation?.diagnostic !== "evidence-source-not-extracted" || originalLimitation.details.kind !== "OTHER") return null;
  const gaps: ContextOnlyCoverageGap[] = [];
  const projectedPages = invoice.pageCoverage.map(page => {
    const source = page.sources[0];
    if (page.sources.length !== 1 || source?.kind !== "OTHER" || !page.complete || !page.fieldsReviewed ||
      page.requirementScope !== "NONE" || invoice.requiredFieldChecks.some(check => check.page === page.page && check.requiredByDocument) ||
      invoice.items.some(item => item.sourcePage === page.page || item.evidenceObservations.some(observation => observation.page === page.page))) return page;
    const observations = (invoice.documentObservations ?? []).filter(observation => observation.page === page.page);
    if (observations.some(observation => observation.kind !== "OTHER" || observation.amountScope !== "CONTEXT" ||
      observation.amount !== null || observation.date !== null)) return page;
    const count = new Set(observations.map(observation => JSON.stringify([
      observation.documentGroup, observation.label, observation.amount, observation.date, observation.text,
    ]))).size;
    if (count >= source.count) return page;
    gaps.push({ page: page.page, kind: "OTHER", expectedSources: source.count, extractedSources: count });
    return { ...page, sources: count > 0 ? [{ ...source, count }] : [] };
  });
  if (gaps.length === 0 || getEvidenceCoverageLimitation({ ...invoice, pageCoverage: projectedPages }, expectedPageCount)) return null;
  return gaps;
}

function concreteFieldCheck(check: { field: string; label: string }) {
  const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[_\s-]+/g, " ").trim();
  const generic = /^(?:all(?: required)? fields|todos(?: os)? campos(?: obrigatorios)?|campos obrigatorios|required fields)$/;
  return !generic.test(normalized(check.field)) && !generic.test(normalized(check.label));
}

function sourceOccurrenceIdentity(source: {
  text: string | null | undefined;
  boundingBox?: unknown;
}) {
  const text = source.text?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return null;
  // A primary row and its mirrored observation are one occurrence. A bounding
  // box still distinguishes two visually separate, otherwise identical rows.
  return JSON.stringify([text, source.boundingBox ?? null]);
}

function extractedSourceCount(
  invoice: InvoiceExtraction,
  page: number,
  kind: EvidenceSourceKind,
) {
  if (kind === "FISCAL_LINE") {
    // Some readers label rows from a retail sale as SALE even though the page
    // inventory correctly distinguishes the sale document from its fiscal
    // lines. A row with visible quantity, unit price and an arithmetically
    // matching total is still a proven fiscal line; no value is inferred.
    const fiscalRow = (item: InvoiceExtraction["items"][number]) => {
      if (item.sourceKind === kind) return true;
      if (item.sourceKind !== "SALE" || item.documentRole !== "LINE_ITEM" ||
        item.quantity === null || item.unitPrice === null || item.totalAmount === null ||
        Number(item.totalAmount) < 0 || !item.sourceText) return false;
      const quantity = Number(item.quantity), unitPrice = Number(item.unitPrice), total = Number(item.totalAmount);
      return [quantity, unitPrice, total].every(Number.isFinite) &&
        Math.abs(quantity * unitPrice - total) <= 0.01 &&
        untracedObservationClaim({ amount: item.totalAmount, date: null, text: item.sourceText }) === null;
    };
    return new Set(invoice.items.filter(item => fiscalRow(item) && item.sourcePage === page && item.sourceText)
      .map(item => item.lineNumber)).size;
  }

  const occurrences = new Set<string>();
  for (const item of invoice.items) {
    const validPrimaryKind = item.sourceKind === kind &&
      (kind !== "CHARGE" || item.documentRole === "AGGREGATE_PAYMENT");
    if (validPrimaryKind && item.sourcePage === page) {
      const identity = sourceOccurrenceIdentity({ text: item.sourceText, boundingBox: item.sourceBoundingBox });
      if (identity) occurrences.add(identity);
    }
    for (const observation of item.evidenceObservations) {
      if (observation.kind !== kind || observation.page !== page) continue;
      const identity = sourceOccurrenceIdentity(observation);
      if (identity) occurrences.add(identity);
    }
  }
  for (const observation of invoice.documentObservations ?? []) {
    if (observation.kind !== kind || observation.page !== page) continue;
    const identity = sourceOccurrenceIdentity(observation);
    if (identity) occurrences.add(identity);
  }
  return occurrences.size;
}

/** Cross-check two representations. This is NOT independent visual verification. */
export function getEvidenceCoverageLimitation(
  invoice: InvoiceExtraction,
  expectedPageCount?: number | null,
): EvidenceCoverageLimitation | null {
  const pages = invoice.pageCoverage;
  const allObservations = [
    ...invoice.items.flatMap(item => item.evidenceObservations),
    ...(invoice.documentObservations ?? []),
  ];
  const required = (expectedPageCount ?? 0) > 1 ||
    (expectedPageCount != null && ["COMPOSITE", "REIMBURSEMENT"].includes(invoice.documentKind));
  const fail = (diagnostic: string, details: Record<string, unknown> = {}): EvidenceCoverageLimitation => ({
    diagnostic,
    message: "A leitura dos comprovantes e das instruções do formulário não foi integralmente comprovada.",
    details,
  });
  const conflictingPrimary = invoice.items.find((item) => (item.sourceKind === "SHEET" ||
    (item.sourceKind === "CHARGE" && item.documentRole === "AGGREGATE_PAYMENT")) &&
    item.evidenceObservations.some((observation) => observation.kind === item.sourceKind && observation.page === item.sourcePage && (
      (item.totalAmount !== null && observation.amount !== null && Math.abs(Number(item.totalAmount) - Number(observation.amount)) > 0.005) ||
      (item.sourceDate != null && observation.date !== null && item.sourceDate !== observation.date && (() => {
        const primaryPurpose = quotedDatePurpose(item.sourceText, item.sourceDate);
        const observedPurpose = quotedDatePurpose(observation.text, observation.date);
        return !primaryPurpose || !observedPurpose || primaryPurpose === observedPurpose;
      })()))));
  if (conflictingPrimary) return fail("evidence-primary-row-conflict", { lineNumber: conflictingPrimary.lineNumber, page: conflictingPrimary.sourcePage });
  const quoteConflict = allObservations.find(observationQuoteConflict);
  if (quoteConflict) return fail("evidence-source-value-quote-conflict", { page: quoteConflict.page, kind: quoteConflict.kind });
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
    const explicitRequirements = invoice.requiredFieldChecks.filter(check => check.page === page.page &&
      check.requiredByDocument && check.requirementBasis === "EXPLICIT_DOCUMENT" && check.requirementEvidence);
    if (page.requirementScope === "NONE" && explicitRequirements.length > 0) {
      // Preserve both declarations for rereading. Do not silently promote NONE to ALL_FIELDS
      // or fabricate checks for fields that have not actually been read.
      return fail("evidence-required-instruction-conflict", { page: page.page });
    }
    for (const source of page.sources) {
      const count = extractedSourceCount(invoice, page.page, source.kind);
      if (source.kind === "FISCAL_LINE") {
        if (count !== source.count) return fail("evidence-source-not-extracted", {
          page: page.page, kind: source.kind, expectedSources: source.count, extractedSources: count,
        });
        continue;
      }
      if (count < source.count) {
        return fail("evidence-source-not-extracted", { page: page.page, kind: source.kind,
          expectedSources: source.count, extractedSources: count });
      }
    }
    if (["ALL_FIELDS", "SPECIFIC_FIELDS"].includes(page.requirementScope)) {
      const checks = invoice.requiredFieldChecks.filter(c => c.page === page.page && concreteFieldCheck(c));
      if (!page.requirementEvidence || checks.length === 0 ||
        !checks.some(c => c.requiredByDocument && c.requirementBasis === "EXPLICIT_DOCUMENT" && c.requirementEvidence) ||
        (page.requirementScope === "ALL_FIELDS" && checks.some(c =>
          !c.requiredByDocument || c.requirementBasis !== "EXPLICIT_DOCUMENT" || !c.requirementEvidence))) {
        return fail("evidence-required-instruction-not-applied", { page: page.page });
      }
    }
  }
  const knownPages = new Set(pageNumbers);
  for (const item of invoice.items.filter(row => row.sourceKind && row.sourceKind !== "UNKNOWN")) {
    if (item.sourcePage === null || !item.sourceText ||
      !pages.find(page => page.page === item.sourcePage)?.sources.some(source => source.kind === item.sourceKind)) {
      return fail(item.sourceKind === "FISCAL_LINE" ? "evidence-source-fiscal-row-not-inventoried" :
        "evidence-primary-source-not-inventoried", {
        page: item.sourcePage, kind: item.sourceKind, lineNumber: item.lineNumber,
      });
    }
  }
  if (invoice.items.some(i => (i.sourcePage !== null && !knownPages.has(i.sourcePage)) ||
    i.evidenceObservations.some(o => o.page !== null && !knownPages.has(o.page)))) {
    return fail("evidence-source-page-outside-inventory");
  }
  for (const observation of allObservations) {
    if (observation.page !== null && !knownPages.has(observation.page)) {
      return fail("evidence-source-page-outside-inventory");
    }
    if (observation.page === null || !pages.find(p => p.page === observation.page)?.sources.some(s => s.kind === observation.kind)) {
      return fail("evidence-source-missing-from-inventory", { page: observation.page, kind: observation.kind });
    }
  }
  // New explicitly typed rows opt in to scalar provenance. Historical snapshots
  // remain readable; they are not retroactively claimed to have this contract.
  if (invoice.items.some(item => item.sourceKind && item.sourceKind !== "UNKNOWN")) {
    for (const item of invoice.items.filter(row => row.sourceKind === "SHEET" ||
      (row.sourceKind === "CHARGE" && row.documentRole === "AGGREGATE_PAYMENT"))) {
      const field = untracedObservationClaim({ amount: item.totalAmount, date: item.sourceDate ?? null, text: item.sourceText });
      if (field) return fail("evidence-source-claim-not-traceable", {
        page: item.sourcePage, kind: item.sourceKind, field, source: "PRIMARY", lineNumber: item.lineNumber,
      });
    }
    for (const observation of allObservations) {
      const field = untracedObservationClaim(observation);
      if (field) return fail("evidence-source-claim-not-traceable", {
        page: observation.page, kind: observation.kind, field,
      });
    }
  }
  return null;
}

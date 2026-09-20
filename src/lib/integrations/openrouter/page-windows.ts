import { invoiceExtractionSchema, type InvoiceExtraction } from "./extraction-contract";
import { untracedObservationClaim } from "./source-value-consistency";

const REPAIRABLE_SOURCE_KINDS = new Set([
  "FISCAL_LINE", "SHEET", "RECEIPT", "SALE", "PAYMENT", "CHARGE", "DISCOUNT",
]);

export type EvidencePageRepairTarget = {
  page: number;
  kind: string;
  expectedSources: number;
  extractedSources: number;
};

function sameNumber(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  const a = Number(left), b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.000_001;
}

function arithmeticConsistent(item: InvoiceExtraction["items"][number]) {
  if (item.quantity === null || item.unitPrice === null || item.totalAmount === null) return null;
  const quantity = Number(item.quantity), unitPrice = Number(item.unitPrice), total = Number(item.totalAmount);
  if (![quantity, unitPrice, total].every(Number.isFinite)) return null;
  return Math.abs(quantity * unitPrice - total) <= 0.05;
}

/** A focused reread may improve page inventory without redefining the document
 * identity/economic layer of rows it already recognized or replacing a
 * previously consistent fiscal scalar with a newly inconsistent OCR value. */
function stabilizeFiscalRows(base: InvoiceExtraction["items"], replacement: InvoiceExtraction["items"]) {
  const candidates = new Map<string, InvoiceExtraction["items"]>();
  for (const item of base.filter(item => item.sourceKind === "FISCAL_LINE" && item.code?.trim())) {
    const key = item.code!.trim().toUpperCase();
    candidates.set(key, [...(candidates.get(key) ?? []), item]);
  }
  const match = (item: InvoiceExtraction["items"][number]) => {
    if (item.sourceKind !== "FISCAL_LINE" || !item.code?.trim()) return null;
    const matches = candidates.get(item.code.trim().toUpperCase()) ?? [];
    return matches.length === 1 ? matches[0] : null;
  };
  const aliasCandidates = new Map<string, Set<string>>();
  for (const item of replacement) {
    const previous = match(item);
    if (item.documentGroup && previous?.documentGroup) {
      const aliases = aliasCandidates.get(item.documentGroup) ?? new Set<string>();
      aliases.add(previous.documentGroup);
      aliasCandidates.set(item.documentGroup, aliases);
    }
  }
  const groupAliases = new Map([...aliasCandidates].flatMap(([source, targets]) =>
    targets.size === 1 ? [[source, [...targets][0]] as const] : []));
  const remapGroup = (group: string | null) => group === null ? null : groupAliases.get(group) ?? group;
  const stabilized: InvoiceExtraction["items"] = [];
  for (const item of replacement) {
    const previous = match(item);
    if (!previous) {
      stabilized.push({ ...item, documentGroup: remapGroup(item.documentGroup),
        evidenceObservations: item.evidenceObservations.map(source => ({ ...source,
          documentGroup: remapGroup(source.documentGroup) })) });
      continue;
    }
    if (!sameNumber(previous.totalAmount, item.totalAmount)) {
      const previousAmountUntraced = previous.totalAmount !== null &&
        untracedObservationClaim({ amount: previous.totalAmount, date: null,
          text: previous.sourceText ?? null }) === "amount";
      const replacementAmountTraced = item.totalAmount !== null &&
        untracedObservationClaim({ amount: item.totalAmount, date: null,
          text: item.sourceText ?? null }) === null;
      if (!previousAmountUntraced || !replacementAmountTraced || arithmeticConsistent(item) !== true) return null;
    }
    const changedFactors = !sameNumber(previous.quantity, item.quantity) || !sameNumber(previous.unitPrice, item.unitPrice);
    let selected = item;
    if (changedFactors) {
      const previousConsistent = arithmeticConsistent(previous), replacementConsistent = arithmeticConsistent(item);
      if (previousConsistent === replacementConsistent) return null;
      selected = previousConsistent ? structuredClone(previous) : item;
    }
    stabilized.push({ ...selected, documentGroup: previous.documentGroup,
      documentRole: previous.documentRole, countsTowardDocumentTotal: previous.countsTowardDocumentTotal,
      evidenceObservations: selected.evidenceObservations.map(source => ({ ...source,
        documentGroup: remapGroup(source.documentGroup) })) });
  }
  return { items: stabilized, groupAliases };
}

/** Select a bounded visual reread only for a proven per-page source deficit. */
export function evidencePageRepairTarget(limitation: {
  diagnostic: string;
  details: Record<string, unknown>;
} | undefined, windowPageCount: number): EvidencePageRepairTarget | null {
  if (!limitation) return null;
  const { page, kind, expectedSources, extractedSources } = limitation.details;
  if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > windowPageCount ||
    typeof kind !== "string" || !REPAIRABLE_SOURCE_KINDS.has(kind)) return null;
  if (limitation.diagnostic !== "evidence-source-not-extracted") {
    const repairable = new Set(["evidence-source-fiscal-row-not-inventoried", "evidence-primary-source-not-inventoried",
      "evidence-source-missing-from-inventory", "evidence-source-claim-not-traceable",
      "evidence-source-value-quote-conflict"]);
    return repairable.has(limitation.diagnostic)
      ? { page: Number(page), kind, expectedSources: 1, extractedSources: 0 } : null;
  }
  if (!Number.isSafeInteger(expectedSources) || !Number.isSafeInteger(extractedSources) ||
    Number(expectedSources) <= Number(extractedSources) || Number(expectedSources) > 200 || Number(extractedSources) < 0) return null;
  return { page: Number(page), kind, expectedSources: Number(expectedSources), extractedSources: Number(extractedSources) };
}

/** Replace one page's source records after a successful isolated reread. Cross-
 * page item relationships are rejected instead of being guessed. */
export function replaceWindowPageEvidence(base: InvoiceExtraction, replacement: InvoiceExtraction, targetPage: number,
  options: { preserveReplacementEconomicLayer: boolean; replacementItemCoverageComplete: boolean }) {
  const basePages = base.pageCoverage;
  const basePage = basePages?.find(page => page.page === targetPage);
  if (!basePage || replacement.pageCoverage?.length !== 1 || replacement.pageCoverage[0].page !== targetPage ||
    !replacement.pageCoverage[0].complete || !replacement.pageCoverage[0].fieldsReviewed) return null;
  const onTarget = (page: number | null | undefined) => page === targetPage;
  const baseTargetLines = new Set(base.items.filter(item => onTarget(item.sourcePage)).map(item => item.lineNumber));
  const baseLines = new Map(base.items.map(item => [item.lineNumber, item]));
  if (base.items.some(item => {
    const target = onTarget(item.sourcePage);
    const observationCrosses = item.evidenceObservations.some(source => onTarget(source.page) !== target);
    const parent = item.parentLineNumber == null ? null : baseLines.get(item.parentLineNumber);
    return observationCrosses || (parent !== null && parent !== undefined && onTarget(parent.sourcePage) !== target);
  }) || replacement.items.some(item => !onTarget(item.sourcePage) ||
    item.evidenceObservations.some(source => !onTarget(source.page))) ||
    (replacement.documentObservations ?? []).some(source => !onTarget(source.page)) ||
    replacement.requiredFieldChecks.some(check => !onTarget(check.page))) return null;
  if (base.items.some(item => !baseTargetLines.has(item.lineNumber) && item.parentLineNumber != null &&
    baseTargetLines.has(item.parentLineNumber))) return null;

  type Entry = { origin: "base" | "replacement"; oldLine: number; item: InvoiceExtraction["items"][number] };
  const stabilized = stabilizeFiscalRows(base.items.filter(item => onTarget(item.sourcePage)), replacement.items);
  if (!stabilized) return null;
  const replacementEntries: Entry[] = stabilized.items.map(item => ({ origin: "replacement", oldLine: item.lineNumber,
    item: { ...structuredClone(item), countsTowardDocumentTotal: options.preserveReplacementEconomicLayer
      ? item.countsTowardDocumentTotal : false } }));
  const entries: Entry[] = [];
  let inserted = false;
  for (const item of base.items) {
    if (onTarget(item.sourcePage)) {
      if (!inserted) { entries.push(...replacementEntries); inserted = true; }
      continue;
    }
    if (!inserted && item.sourcePage !== null && item.sourcePage > targetPage) {
      entries.push(...replacementEntries); inserted = true;
    }
    entries.push({ origin: "base", oldLine: item.lineNumber, item: structuredClone(item) });
  }
  if (!inserted) entries.push(...replacementEntries);
  const lineMaps = { base: new Map<number, number>(), replacement: new Map<number, number>() };
  entries.forEach((entry, index) => lineMaps[entry.origin].set(entry.oldLine, index + 1));
  const items = entries.map((entry, index) => ({ ...entry.item, lineNumber: index + 1,
    parentLineNumber: entry.item.parentLineNumber == null ? null : lineMaps[entry.origin].get(entry.item.parentLineNumber) ?? null }));
  if (entries.some((entry, index) => entry.item.parentLineNumber != null && items[index].parentLineNumber === null)) return null;
  const economicLines = items.filter(item => item.countsTowardDocumentTotal).map(item => item.lineNumber);
  const complete = base.itemCoverage.status === "COMPLETE" &&
    (!options.preserveReplacementEconomicLayer || options.replacementItemCoverageComplete) && economicLines.length > 0;
  const replacementPage = structuredClone(replacement.pageCoverage![0]);
  // A focused reread may discover more sources, but it cannot prove that a
  // source already inventoried on the original page disappeared. Preserve the
  // union and the highest declared count so a narrower model response cannot
  // manufacture complete coverage by shrinking the inventory.
  for (const source of basePage.sources) {
    const rereadSource = replacementPage.sources.find(candidate => candidate.kind === source.kind);
    if (rereadSource) rereadSource.count = Math.max(rereadSource.count, source.count);
    else replacementPage.sources.push(structuredClone(source));
  }
  const requirementRank = { NONE: 0, SPECIFIC_FIELDS: 1, ALL_FIELDS: 2, UNKNOWN: 3 } as const;
  if (requirementRank[basePage.requirementScope] > requirementRank[replacementPage.requirementScope]) {
    replacementPage.requirementScope = basePage.requirementScope;
    replacementPage.requirementEvidence = basePage.requirementEvidence;
  } else if (!replacementPage.requirementEvidence && basePage.requirementEvidence) {
    replacementPage.requirementEvidence = basePage.requirementEvidence;
  }
  const pageCoverage = basePages!.map(page => page.page === targetPage
    ? replacementPage : structuredClone(page));
  const output = invoiceExtractionSchema.safeParse({ ...structuredClone(base), items,
    documentObservations: [...(base.documentObservations ?? []).filter(source => !onTarget(source.page)).map(source => structuredClone(source)),
      ...(replacement.documentObservations ?? []).map(source => ({ ...structuredClone(source),
        documentGroup: source.documentGroup === null ? null : stabilized.groupAliases.get(source.documentGroup) ?? source.documentGroup }))],
    requiredFieldChecks: [...base.requiredFieldChecks.filter(check => !onTarget(check.page)).map(check => structuredClone(check)),
      ...replacement.requiredFieldChecks.map(check => structuredClone(check))],
    pageCoverage,
    itemCoverage: complete ? { status: "COMPLETE", declaredItemCount: null, extractedItemCount: economicLines.length,
      firstLineNumber: economicLines[0] ?? null, lastLineNumber: economicLines.at(-1) ?? null,
      missingLineNumbers: [], evidence: "Camada econômica preservada após releitura focal da página." }
      : { ...structuredClone(base.itemCoverage), status: "UNKNOWN", extractedItemCount: economicLines.length,
        firstLineNumber: economicLines[0] ?? null, lastLineNumber: economicLines.at(-1) ?? null },
  });
  return output.success ? output.data : null;
}

/** Plan every page before starting paid work. Exceeding a caller's request cap
 * is an error, never permission to silently truncate the document. */
export function planPageWindows(pageCount: number, windowSize: number, maxWindows: number) {
  if (![pageCount, windowSize, maxWindows].every(value => Number.isSafeInteger(value) && value > 0) ||
    pageCount > 500 || windowSize > 4 || maxWindows > 125) throw new Error("Invalid bounded page-window plan.");
  const count = Math.ceil(pageCount / windowSize);
  if (count > maxWindows) throw new Error("Whole-document coverage exceeds the allowed request count.");
  return Array.from({ length: count }, (_, window) =>
    Array.from({ length: Math.min(windowSize, pageCount - window * windowSize) }, (_, index) => window * windowSize + index + 1));
}

/** Coordinate conversion only. This does not associate expenses, merge windows
 * or certify whole-document coverage. Original excerpts are never rewritten. */
export function remapWindowEvidence(extraction: InvoiceExtraction, originalPages: number[], originalPageCount: number) {
  if (!Number.isSafeInteger(originalPageCount) || originalPageCount < 1 || originalPageCount > 500 ||
    originalPages.length < 1 || originalPages.length > 4 || new Set(originalPages).size !== originalPages.length ||
    originalPages.some(page => !Number.isSafeInteger(page) || page < 1 || page > originalPageCount)) {
    throw new Error("Invalid original page map.");
  }
  const page = (local: number | null): number | null => {
    if (local === null) return null;
    if (!Number.isSafeInteger(local) || local < 1 || local > originalPages.length) throw new Error("Evidence outside its page window.");
    return originalPages[local - 1];
  };
  return {
    ...extraction,
    items: extraction.items.map(item => ({ ...item, sourcePage: page(item.sourcePage),
      evidenceObservations: item.evidenceObservations.map(source => ({ ...source, page: page(source.page) })) })),
    documentObservations: extraction.documentObservations?.map(source => ({ ...source, page: page(source.page) })),
    requiredFieldChecks: extraction.requiredFieldChecks.map(check => ({ ...check, page: page(check.page) })),
    pageCoverage: extraction.pageCoverage?.map(entry => ({ ...entry, page: page(entry.page)! })),
    // Window-complete is not document-complete. Keep that distinction in the
    // payload itself, not just a UI label or a comment in the probe report.
    itemCoverage: { ...extraction.itemCoverage, status: "UNKNOWN" as const },
    supportCoverage: extraction.supportCoverage ? { ...extraction.supportCoverage, status: "UNKNOWN" as const } : undefined,
  };
}

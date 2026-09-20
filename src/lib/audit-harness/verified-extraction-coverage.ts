import type { InvoiceExtraction } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { economicSupportReference, matchedEconomicSupportLines } from "@/lib/integrations/openrouter/support-matching";
import { quotedDatePurpose, untracedObservationClaim } from "@/lib/integrations/openrouter/source-value-consistency";
import { isMonetaryEvidence } from "./amount-review";
import { hasInsufficientAuditBasis } from "./policy";
import type { VerificationResponse } from "./verification";

function documentReference(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** A complete independent pass may close an UNKNOWN support declaration only
 * for a self-contained composite whose every explicit reference is already in
 * the attachment. PARTIAL sets, reimbursements and absent references remain
 * insufficient and are never promoted. The returned invoice is a diagnostic
 * projection; extracted evidence is not mutated. */
export function verifiedSupportCoverageProjection(input: { invoice: InvoiceExtraction; coverageComplete: boolean;
  response: VerificationResponse }) {
  const { invoice, response } = input;
  const coverage = invoice.supportCoverage;
  if (!input.coverageComplete || response.status === "LIMITED" || !Array.isArray(response.limitations) ||
    response.limitations.length !== 0 || !Array.isArray(response.checks) || !coverage) return null;

  if ((invoice.documentKind === "REIMBURSEMENT" || invoice.documentKind === "COMPOSITE") &&
    coverage.status === "PARTIAL" && coverage.basis === "DOCUMENT_REFERENCES") {
    const supported = matchedEconomicSupportLines(invoice);
    const missingItems = invoice.items.filter(item => item.countsTowardDocumentTotal === true &&
      !supported.has(item.lineNumber));
    const declaredMissing = new Set(coverage.missingDocuments.map(documentReference));
    const actualMissing = new Set(missingItems.map(economicSupportReference).map(documentReference));
    const sameGap = declaredMissing.size === actualMissing.size &&
      [...actualMissing].every(reference => declaredMissing.has(reference));
    const supportKinds = new Set(["FISCAL_LINE", "RECEIPT", "SALE", "PAYMENT", "CHARGE"]);
    const explicitlyLinked = (item: InvoiceExtraction["items"][number]) => response.checks.some(check => {
      if (check.lineNumber !== item.lineNumber || check.state === "LIMITATION" ||
        !check.comparison || check.comparison.outcome === "UNRELATED") return false;
      const left = check.comparison.leftEvidenceIndex;
      const right = check.comparison.rightEvidenceIndex;
      if (typeof left !== "number" || typeof right !== "number" || !Number.isSafeInteger(left) ||
        !Number.isSafeInteger(right) || left < 0 || right < 0 || left >= check.evidence.length ||
        right >= check.evidence.length || left === right) return false;
      const indexes = [left, right];
      const pair = indexes.map(index => check.evidence[index]);
      const primary = pair.find(evidence => evidence.page === item.sourcePage &&
        evidence.source.trim().toUpperCase() === item.sourceKind &&
        untracedObservationClaim({ amount: item.totalAmount, date: item.sourceDate ?? null,
          text: evidence.quote }) === null);
      const support = pair.find(evidence => evidence !== primary && supportKinds.has(evidence.source.trim().toUpperCase()) &&
        evidence.source.trim().toUpperCase() !== "SHEET" && item.totalAmount !== null &&
        untracedObservationClaim({ amount: item.totalAmount, date: null, text: evidence.quote }) === null);
      return Boolean(primary && support);
    });
    if (missingItems.length > 0 && sameGap && missingItems.every(explicitlyLinked)) {
      return { ...invoice, supportCoverage: { ...coverage, status: "COMPLETE" as const,
        presentDocuments: [...coverage.referencedDocuments], missingDocuments: [],
        evidence: "As fontes pendentes foram vinculadas explicitamente pela verificação independente do documento." } };
    }
    return null;
  }

  if (invoice.documentKind !== "COMPOSITE" || coverage.status !== "UNKNOWN" || coverage.basis !== "NONE" ||
    coverage.missingDocuments.length !== 0 || coverage.referencedDocuments.length === 0) return null;
  const present = new Set(coverage.presentDocuments.map(documentReference).filter(Boolean));
  if (coverage.referencedDocuments.some(reference => !present.has(documentReference(reference)))) return null;
  const aggregatePayments = invoice.items.filter(item => item.documentRole === "AGGREGATE_PAYMENT");
  if (aggregatePayments.length === 0 || aggregatePayments.some(item => {
    if (!item.sourceKind || item.sourceKind === "UNKNOWN" || item.sourcePage === null) return true;
    const check = response.checks.find(candidate => candidate.key === `line:${item.lineNumber}` && candidate.state === "VERIFIED");
    return !check?.evidence.some(evidence => evidence.page === item.sourcePage &&
      evidence.source.trim().toUpperCase() === item.sourceKind &&
      untracedObservationClaim({ amount: item.totalAmount, date: item.sourceDate ?? null, text: evidence.quote }) === null);
  })) return null;
  return { ...invoice, supportCoverage: { ...coverage, status: "COMPLETE" as const,
    basis: "DOCUMENT_REFERENCES" as const,
    evidence: "Conjunto autossuficiente conferido integralmente pela verificação independente." } };
}

/** Resolve only independently checked inventory/quote bookkeeping. Never fill
 * absent rows or pages. This diagnostic projection is not persisted evidence. */
export function verifiedExtractionCoverageResolved(input: { invoice: InvoiceExtraction; pageCount: number | null;
  coverageComplete: boolean; response: VerificationResponse }) {
  const { invoice, pageCount, response } = input;
  if (!input.coverageComplete || response.status === "LIMITED" || response.limitations?.length !== 0 || !Array.isArray(response.checks) ||
    hasInsufficientAuditBasis(invoice)) return false;
  const gap = getEvidenceCoverageLimitation(invoice, pageCount);
  if (!gap || !["evidence-source-missing-from-inventory", "evidence-source-claim-not-traceable", "evidence-primary-row-conflict"].includes(gap.diagnostic)) return false;
  const projected = structuredClone(invoice);
  // A document-level observation can be traceable even when the page inventory
  // omitted its generic OTHER bucket. A complete independent coverage check may
  // close only that bookkeeping omission; it never creates or changes evidence.
  if (gap.diagnostic === "evidence-source-missing-from-inventory" && gap.details.kind === "OTHER") {
    const pageNumber = gap.details.page;
    const page = typeof pageNumber === "number"
      ? projected.pageCoverage?.find(candidate => candidate.page === pageNumber) : undefined;
    const observations = typeof pageNumber === "number"
      ? (projected.documentObservations ?? []).filter(source => source.page === pageNumber && source.kind === "OTHER") : [];
    const identities = new Set(observations.map(source => JSON.stringify([
      source.documentGroup, source.label, source.amount, source.date, source.text,
    ])));
    const coverageProof = response.checks.find(check => check.key === "document:coverage" &&
      check.state === "VERIFIED")?.evidence.some(evidence => evidence.page === pageNumber &&
        (evidence.source.trim().toUpperCase() === "OTHER" ||
          page?.sources.some(source => source.kind === evidence.source.trim().toUpperCase())));
    if (observations.length > 0) {
      if (!page || !coverageProof || identities.size !== observations.length ||
        observations.some(source => !source.text?.trim() || untracedObservationClaim(source) !== null)) return false;
      page.sources.push({ kind: "OTHER", count: observations.length });
    }
  }
  // A boleto can print an issue date and a due date. An unlabeled primary
  // quote cannot distinguish them by itself; use only separately labeled
  // evidence from this exact independently verified row, source and page.
  if (gap.diagnostic === "evidence-primary-row-conflict") {
    for (const item of projected.items) {
      if (item.sourceKind !== "CHARGE" || item.documentRole !== "AGGREGATE_PAYMENT" ||
        item.sourcePage == null || !item.sourceDate) continue;
      const observations = item.evidenceObservations.filter(source => source.kind === "CHARGE" &&
        source.page === item.sourcePage && source.date !== null && source.date !== item.sourceDate);
      if (!observations.length) continue;
      const check = response.checks.find(candidate => candidate.key === `line:${item.lineNumber}` && candidate.state === "VERIFIED");
      const evidence = check?.evidence.filter(proof => proof.page === item.sourcePage && proof.source.trim().toUpperCase() === "CHARGE") ?? [];
      const dateProof = (date: string) => {
        const proofs = evidence.filter(proof => quotedDatePurpose(proof.quote, date));
        const purposes = new Set(proofs.map(proof => quotedDatePurpose(proof.quote, date)));
        return purposes.size === 1 ? proofs[0] : undefined;
      };
      const primary = dateProof(item.sourceDate);
      const amount = item.totalAmount === null ? undefined : evidence.find(proof => isMonetaryEvidence(proof) &&
        !untracedObservationClaim({ amount: item.totalAmount, date: null, text: proof.quote }));
      if (!primary || (item.totalAmount !== null && !amount)) return false;
      const primaryPurpose = quotedDatePurpose(primary.quote, item.sourceDate);
      const existingPrimaryPurpose = quotedDatePurpose(item.sourceText, item.sourceDate);
      if (existingPrimaryPurpose && existingPrimaryPurpose !== primaryPurpose) return false;
      for (const source of observations) {
        const proof = dateProof(source.date!);
        if (!proof) return false;
        const purpose = quotedDatePurpose(proof.quote, source.date);
        const existingPurpose = quotedDatePurpose(source.text, source.date);
        if (purpose === primaryPurpose || (existingPurpose && existingPurpose !== purpose)) return false;
        source.text = [...new Set([proof.quote, ...(amount ? [amount.quote] : [])])].join("\n");
      }
      item.sourceText = [...new Set([primary.quote, ...(amount ? [amount.quote] : [])])].join("\n");
    }
  }
  // A primary row and its observations carry the same provenance contract.
  // A complete verifier may repair an omitted quote, but never change the
  // amount/date, source kind, page or row identity to make it pass.
  for (const item of projected.items) {
    if (!(item.sourceKind === "SHEET" || (item.sourceKind === "CHARGE" && item.documentRole === "AGGREGATE_PAYMENT")) || item.sourcePage == null ||
      !untracedObservationClaim({ amount: item.totalAmount, date: item.sourceDate ?? null, text: item.sourceText ?? null })) continue;
    const check = response.checks.find(check => check.key === `line:${item.lineNumber}` && check.state === "VERIFIED");
    const proof = check?.evidence.find(evidence => evidence.source.trim().toUpperCase() === item.sourceKind &&
      evidence.page === item.sourcePage && (item.totalAmount === null || isMonetaryEvidence(evidence)) &&
      !untracedObservationClaim({ amount: item.totalAmount, date: item.sourceDate ?? null, text: evidence.quote }));
    if (!proof) return false;
    item.sourceText = proof.quote;
  }
  const sources = [...projected.items.flatMap(item => item.evidenceObservations.map(source => ({source, key: `line:${item.lineNumber}`}))),
    ...(projected.documentObservations ?? []).map(source => ({ source, key: "document:total" }))];
  for (const { source, key } of sources) {
    const page = projected.pageCoverage?.find(page => page.page === source.page);
    if (!page || source.page === null) return false;
    const missingKind = !page.sources.some(entry => entry.kind === source.kind);
    const missingTrace = untracedObservationClaim(source) !== null;
    if (!missingKind && !missingTrace) continue;
    const check = response.checks.find(check => check.key === key && check.state !== "LIMITATION");
    const proof = check?.evidence.find(evidence => evidence.source.trim().toUpperCase() === source.kind &&
      evidence.page === source.page && (source.amount === null || isMonetaryEvidence(evidence)) &&
      untracedObservationClaim({ ...source, text: evidence.quote, amountScope: undefined }) === null &&
      (source.amount !== null || source.date !== null || evidence.quote.trim() === source.text?.trim()));
    if (!proof) return false;
    if (missingTrace) source.text = proof.quote;
  }
  for (const { source } of sources) {
    const page = projected.pageCoverage!.find(page => page.page === source.page)!;
    if (!page.sources.some(entry => entry.kind === source.kind)) {
      const matching = sources.filter(entry => entry.source.page === source.page && entry.source.kind === source.kind);
      page.sources.push({ kind: source.kind, count: new Set(matching.map(({source:o}) =>
        JSON.stringify([o.documentGroup, o.label, o.amount, o.date, o.text]))).size });
    }
  }
  return getEvidenceCoverageLimitation(projected, pageCount) === null;
}

import type { HarnessInvoice } from "./contracts";

type SourceKind = NonNullable<HarnessInvoice["items"][number]["sourceKind"]> | "DISCOUNT";
export type AmountReviewSource = { kind: SourceKind; page: number };

const positivePage = (page: number | null | undefined): page is number =>
  Number.isSafeInteger(page) && (page ?? 0) > 0;
const knownAmount = (amount: string | null | undefined) =>
  typeof amount === "string" && /^-?\d+(?:\.\d+)?$/.test(amount.trim());

/** Attention to monetary sources, not an assertion that their extracted amounts
 * are correct or that different document layers should be added together. Do
 * not send expected amounts: the verifier must reread the original independently. */
export function buildAmountReviewSources(invoice: HarnessInvoice) {
  return invoice.items.flatMap(item => {
    const sources: AmountReviewSource[] = [
      ...(item.sourceKind && positivePage(item.sourcePage) && knownAmount(item.totalAmount)
        ? [{ kind: item.sourceKind, page: item.sourcePage }] : []),
      ...(item.evidenceObservations ?? []).flatMap(source =>
        positivePage(source.page) && knownAmount(source.amount)
          ? [{ kind: source.kind, page: source.page }] : []),
    ];
    const unique = [...new Map(sources.map(source => [JSON.stringify([source.kind, source.page]), source])).values()];
    return unique.length ? [{ lineNumber: item.lineNumber, sources: unique }] : [];
  });
}

/** Reading each amount is not reconciliation. Ask for an explicit disposition
 * of every pair already associated with a row, without asserting that the
 * relationship or the extracted values are correct. Different layers may
 * reconcile through composition, discounts or partial payments. */
export function buildAmountReviewPairs(invoice: HarnessInvoice) {
  return buildAmountReviewSources(invoice).flatMap(({ lineNumber, sources }) =>
    sources.flatMap((left, leftIndex) => sources.slice(leftIndex + 1).map((right, offset) => ({
      key: `amount-pair:${lineNumber}:${leftIndex + 1}:${leftIndex + offset + 2}`,
      lineNumber,
      sources: [left, right] as [AmountReviewSource, AmountReviewSource],
    }))),
  );
}

/** Require a monetary dimension and a visible monetary token. A date, time,
 * quantity or receipt ID alone cannot prove that an amount was inspected.
 * This validates the trace only, never the truth or reconciliation of a value. */
export function isMonetaryEvidence(evidence: { field: string | null; quote: string }) {
  const field = evidence.field?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
  if (!/(?:\b(?:valor|valores|amount|amounts|total|totais|price|preco|desconto|descontos|discount|discounts)\b|^(?:totalamount|unitprice|paymentamount|discountamount)$)/u.test(field)) return false;
  const text = evidence.quote
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}([/.,-])\d{1,2}\1(?:\d{4}|\d{2})\b/gu, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu, " ");
  // Some fiscal/POS printers expose monetary totals with three or four decimal
  // places. Require an explicit monetary label/currency for that precision so
  // quantities, tax rates and identifiers do not become monetary evidence.
  // This recognizes a trace; it never rounds or changes a stored amount.
  const extendedPrecision = /(?:R\$\s*|\bBRL\s*|\b(?:valor\s+(?:pago|total|liquido|bruto)|total\s+(?:geral|pago))\s*[:=]?\s*)-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{3,4}(?![\p{L}\p{N}.,/])/iu
    .test(text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if (extendedPrecision) return true;
  return /(?<![\p{L}\p{N}.,/])-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\p{L}\p{N}.,/])|(?<![\p{L}\p{N}.,/])-?\d+\.\d{2}(?![\p{L}\p{N}.,/])/u.test(text) ||
    /(?:R\$|US\$|\b(?:BRL|USD|EUR|GBP)\b|[$€£])\s*-?\d+(?![\p{L}\p{N}.,/])/u.test(text);
}

export function hasAmountReviewEvidence(sources: AmountReviewSource[], evidence: {
  page: number; source: string; field: string | null; quote: string;
}[]) {
  return sources.every(source => evidence.some(quote => quote.page === source.page &&
    quote.source.trim().toUpperCase() === source.kind && isMonetaryEvidence(quote)));
}

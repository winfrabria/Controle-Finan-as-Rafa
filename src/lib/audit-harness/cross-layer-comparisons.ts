import { isValidIsoCalendarDate } from "@/lib/calendar-date";
import type { HarnessInvoice } from "./contracts";

type Row = HarnessInvoice["items"][number];
const words = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .match(/[\p{L}\p{N}]+/gu) ?? [];

function cents(value: string | null) {
  if (value === null || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole + fraction.padEnd(2, "0"));
  return amount > BigInt(0) ? amount.toString() : null;
}

function sourceLocated(row: Row) {
  return Number.isSafeInteger(row.sourcePage) && (row.sourcePage ?? 0) > 0 && Boolean(row.sourceText?.trim()) &&
    typeof row.sourceDate === "string" && isValidIsoCalendarDate(row.sourceDate);
}

function descriptionContains(left: Row, right: Row) {
  const a = words(left.description), b = words(right.description);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // A generic single word or price is not a useful relationship candidate.
  if (shorter.filter(word => /\p{L}/u.test(word) && word.length >= 3).length < 2) return false;
  return longer.some((_, start) => shorter.every((word, offset) => longer[start + offset] === word));
}

/** Suggest comparison across explicitly non-overlapping expense/support
 * layers, even if extraction assigned different groups. Never merge records,
 * infer identity or create a finding. Ambiguous many-to-many candidates remain
 * unpaired; date equality is deliberately NOT required to inspect a date. */
export function buildCrossLayerDateComparisons(invoice: HarnessInvoice) {
  const sheets = invoice.items.filter(row => row.sourceKind === "SHEET" && row.countsTowardDocumentTotal === true && sourceLocated(row));
  const receipts = invoice.items.filter(row => row.sourceKind === "RECEIPT" && row.countsTowardDocumentTotal === false && sourceLocated(row));
  const receiptBuckets = new Map<string, Row[]>();
  for (const row of receipts) {
    const amount = cents(row.totalAmount); if (amount === null) continue;
    receiptBuckets.set(amount, [...(receiptBuckets.get(amount) ?? []), row]);
  }
  const pairs = sheets.flatMap(sheet => {
    const amount = cents(sheet.totalAmount); if (amount === null) return [];
    return (receiptBuckets.get(amount) ?? []).filter(receipt => receipt.sourcePage !== sheet.sourcePage && descriptionContains(sheet, receipt))
      .map(receipt => ({ sheet, receipt }));
  });
  const degree = new Map<number, number>();
  for (const pair of pairs) for (const row of [pair.sheet, pair.receipt]) degree.set(row.lineNumber, (degree.get(row.lineNumber) ?? 0) + 1);
  return pairs.filter(({ sheet, receipt }) => degree.get(sheet.lineNumber) === 1 && degree.get(receipt.lineNumber) === 1)
    .map(({ sheet, receipt }) => ({ key: `layer-pair:${sheet.lineNumber}:${receipt.lineNumber}`,
      lineNumbers: [sheet.lineNumber, receipt.lineNumber], pages: [sheet.sourcePage!, receipt.sourcePage!],
      basis: "UNIQUE_DESCRIPTION_AND_AMOUNT_ACROSS_LAYERS" as const, relationship: "UNCONFIRMED" as const }));
}

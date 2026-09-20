import { isValidIsoCalendarDate } from "@/lib/calendar-date";

const numericDate = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g;
const normalizeQuote = (text: string) => text.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-");

export function inferredAdjustmentScope(amount: string | null | undefined, text: string | null | undefined) {
  return amount !== null && amount !== undefined && Number(amount) < 0 &&
    /\b(?:descontos?|discounts?|abatimentos?|ajustes?)\b/i.test(text ?? "")
    ? "ADJUSTMENT" as const
    : undefined;
}

function fullQuotedDate(token: string) {
  const parts = token.split(/[-/.]/);
  const value = parts[0].length === 4 ? parts : [parts[2], parts[1], parts[0]];
  const iso = value.map((part, index) => index ? part.padStart(2, "0") : part).join("-");
  return isValidIsoCalendarDate(iso) ? iso : null;
}

/** Repairs require an unambiguous full-year quote; never guess a century or date role. */
export function quoteHasOnlyDate(text: string, date: string) {
  if (!isValidIsoCalendarDate(date)) return false;
  const tokens = normalizeQuote(text).match(numericDate) ?? [];
  return tokens.length > 0 && tokens.every(token => fullQuotedDate(token) === date);
}

export function quotedDatePurpose(text: string | null, date: string | null | undefined) {
  if (!text || !date || !isValidIsoCalendarDate(date)) return null;
  const quote = normalizeQuote(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const roles = new Set<"DUE_DATE" | "ISSUE_DATE" | "PROCESSING_DATE">();
  for (const match of quote.matchAll(numericDate)) {
    if (fullQuotedDate(match[0]) !== date) continue;
    // Bind a label to this exact printed date, not a keyword anywhere on the page.
    const prefix = quote.slice(Math.max(0, match.index - 45), match.index);
    if (/(?:\bvencimento|\bvence(?: em)?|\bdue date)\s*[:=-]?\s*$/.test(prefix)) roles.add("DUE_DATE");
    else if (/(?:\bemissao|\bdata (?:do documento|do doc\.?|de emissao)|\bissue date)\s*[:=-]?\s*$/.test(prefix)) roles.add("ISSUE_DATE");
    else if (/\bdata d[oe] processamento\s*[:=-]?\s*$/.test(prefix)) roles.add("PROCESSING_DATE");
    else return null;
  }
  return roles.size === 1 ? [...roles][0] : null;
}

/** Scalar provenance is not independent visual proof, but a name alone cannot support a value/date card. */
export function untracedObservationClaim(observation: {
  amount: string | null; date: string | null; text: string | null; amountScope?: string;
}): "amount" | "date" | null {
  if (observation.amountScope === "CONTEXT") return null;
  const quote = normalizeQuote(observation.text ?? "");
  if (observation.amount !== null) {
    // Strip dates before matching numbers: the day/month cannot prove a monetary amount.
    const tokens = quote.replace(numericDate, " ").match(/(?<![\d.,/])(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?!\d|[.,/]\d)/g) ?? [];
    const expected = Number(observation.amount);
    // Discounts and other adjustments are commonly printed as a positive
    // magnitude ("DESCONTO 2,00") even though the normalized economic line is
    // signed (-2.00). The explicit ADJUSTMENT scope is what makes the absolute
    // comparison safe; ordinary amounts keep their original sign semantics.
    const expectedValues = observation.amountScope === "ADJUSTMENT"
      ? [expected, Math.abs(expected)]
      : [expected];
    const present = tokens.some((token) => {
      const value = Number(token.includes(",") ? token.replaceAll(".", "").replace(",", ".")
        : /^\d{1,3}(?:\.\d{3})+$/.test(token) ? token.replaceAll(".", "") : token);
      return Number.isFinite(value) && expectedValues.some(candidate =>
        Number.isFinite(candidate) && Math.abs(value - candidate) < 0.005);
    });
    if (!present) return "amount";
  }
  if (observation.date !== null) {
    const [year, month, day] = observation.date.split("-").map(Number);
    const dates = quote.match(numericDate) ?? [];
    const present = dates.some((token) => {
      const parts = token.split(/[-/.]/).map(Number);
      return token.match(/^\d{4}/)
        ? parts[0] === year && parts[1] === month && parts[2] === day
        : parts[0] === day && parts[1] === month &&
          (parts[2] === year || (token.split(/[-/.]/)[2].length === 2 && parts[2] === year % 100));
    });
    if (!present) return "date";
  }
  return null;
}

/** Quality check only: a conflicting quote triggers rereading, never a finding. */
export function observationQuoteConflict(observation: { amount: string | null; text: string | null; amountScope?: string }) {
  if (!observation.amount || !observation.text ||
    !/R\$|\btotal\b/i.test(observation.text) ||
    (observation.amountScope && !["ITEM_TOTAL", "DOCUMENT_TOTAL"].includes(observation.amountScope))) return false;
  const tokens = observation.text.match(/(?<![\d.,/])(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\d.,/])|(?<![\d.,/])\d+\.\d{2}(?![\d.,/])/g) ?? [];
  if (tokens.length !== 1) return false;
  const quoted = Number(tokens[0].includes(",") ? tokens[0].replaceAll(".", "").replace(",", ".") : tokens[0]);
  const extracted = Number(observation.amount);
  return Number.isFinite(quoted) && Number.isFinite(extracted) && Math.abs(quoted - extracted) > 0.05;
}

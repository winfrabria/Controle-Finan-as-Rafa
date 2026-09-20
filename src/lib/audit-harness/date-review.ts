import { isValidIsoCalendarDate } from "@/lib/calendar-date";
import { untracedObservationClaim } from "@/lib/integrations/openrouter/source-value-consistency";
import type { HarnessInvoice } from "./contracts";

const positivePage = (page: number | null | undefined): page is number =>
  Number.isSafeInteger(page) && (page ?? 0) > 0;

/** Reading attention, never a guessed link or a finding. Independent rereading
 * is reserved for competing traced dates; a single/agreed date is already
 * locatable and does not justify expanding every row check. */
export function buildDateReviewSources(invoice: HarnessInvoice) {
  return invoice.items.flatMap(item => {
    const sources = [
      ...(item.sourceDate?.trim() && positivePage(item.sourcePage) &&
        !untracedObservationClaim({ amount: null, date: item.sourceDate, text: item.sourceText ?? null })
        ? [{ date: item.sourceDate, page: item.sourcePage }] : []),
      ...(item.evidenceObservations ?? []).flatMap(source =>
        source.date?.trim() && positivePage(source.page) &&
          !untracedObservationClaim({ amount: null, date: source.date, text: source.text ?? null })
          ? [{ date: source.date, page: source.page }] : []),
    ];
    if (new Set(sources.map(source => source.date)).size < 2) return [];
    const pages = [...new Set(sources.map(source => source.page))].sort((left, right) => left - right);
    return pages.length ? [{ lineNumber: item.lineNumber, pages }] : [];
  });
}

/** Extract only explicit valid calendar claims from a date-labelled excerpt.
 * Two-digit years remain two-digit years; no century is inferred here. */
export function datedEvidenceClaims(evidence: { field: string | null; quote: string }) {
  const field = evidence.field?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
  if (!/(?:\b(?:data|datas|date|dates|emissao|vencimento)\b|^(?:sourcedate|issuedat|duedate)$)/u.test(field)) return [];
  const tokens: string[] = evidence.quote.match(/(?<![\p{L}\p{N}])(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))(?![\p{L}\p{N}])/gu) ?? [];
  // Handwritten receipts may separate the date with commas. Require an explicit
  // date label so a list of numbers is not silently treated as a calendar date.
  for (const match of evidence.quote.matchAll(/\b(?:data|date|emiss[aã]o)\s*:?\s*(\d{1,2}),\s*(\d{1,2}),\s*(\d{4}|\d{2})(?![\p{L}\p{N},])/giu)) {
    tokens.push(`${match[1]}/${match[2]}/${match[3]}`);
  }
  const claims = tokens.flatMap(token => {
    if (token.includes("-")) return isValidIsoCalendarDate(token) ? [token] : [];
    const [day, month, year] = token.split("/");
    const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (year.length === 4) return isValidIsoCalendarDate(normalized) ? [normalized] : [];
    // Calendar bounds without asserting a century or leap-year interpretation.
    const monthDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return Number(day) > 0 && Number(day) <= (monthDays[Number(month) - 1] ?? 0) ? [normalized] : [];
  });
  // Receipts also write dates in words. Accept only an explicit complete
  // Portuguese calendar date, not a month mention or an inferred year.
  const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const text = evidence.quote.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const writtenDates = text.matchAll(/(?<![\p{L}\p{N}])(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})(?![\p{L}\p{N}])/gu);
  for (const [, day, month, year] of writtenDates) {
    const normalized = `${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (isValidIsoCalendarDate(normalized)) claims.push(normalized);
  }
  return [...new Set(claims)];
}

/** This checks the trace's dimension, not the truth of the photographed date. */
export function isDatedEvidence(evidence: { field: string | null; quote: string }) {
  return datedEvidenceClaims(evidence).length > 0;
}

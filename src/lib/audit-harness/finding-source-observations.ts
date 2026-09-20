import { z } from "zod";
import { isValidIsoCalendarDate } from "@/lib/calendar-date";

export const FINDING_SOURCE_KINDS = ["FISCAL_LINE", "SHEET", "RECEIPT", "SALE", "PAYMENT", "CHARGE", "DISCOUNT", "OTHER"] as const;
// Large reimbursement packets can legitimately contain one source per page.
// This is a defensive anti-runaway bound, not a business or document limit.
export const MAX_FINDING_SOURCE_OBSERVATIONS = 500;

export const FINDING_CLAIM_SCOPES = ["DOCUMENT_CONTENT", "ENTITY_IDENTITY", "WORK_AUTHORIZATION", "OTHER"] as const;
// Optional only for stored responses predating this contract; do not infer a
// scope for history. New provider responses include the nullable field.
export const findingClaimScopeSchema = z.enum(FINDING_CLAIM_SCOPES).nullable().optional();
export const FINDING_CLAIM_SCOPE_JSON_SCHEMA = {
  type: ["string", "null"], enum: [...FINDING_CLAIM_SCOPES, null],
} as const;

export const findingSourceObservationSchema = z.object({
  kind: z.enum(FINDING_SOURCE_KINDS), label: z.string().trim().min(1).max(120),
  page: z.number().int().positive(), text: z.string().trim().min(1).max(500),
  value: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const FINDING_SOURCE_OBSERVATIONS_JSON_SCHEMA = {
  type: "array", maxItems: MAX_FINDING_SOURCE_OBSERVATIONS, items: {
    type: "object", additionalProperties: false, required: ["kind", "label", "page", "text", "value"],
    properties: { kind: { type: "string", enum: FINDING_SOURCE_KINDS }, label: { type: "string", minLength: 1, maxLength: 120 },
      page: { type: "integer", minimum: 1 }, text: { type: "string", minLength: 1, maxLength: 500 },
      value: { type: ["string", "null"], minLength: 1, maxLength: 500 } },
  },
} as const;

const normalize = (value: string) => value.normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

function valueType(field: unknown) {
  const fieldName = typeof field === "string" ? normalize(field).replace(/[_-]+/g, " ") : "";
  const compact = fieldName.replace(/\s+/g, "");
  if (["totalamount", "amount", "valor", "valores", "valortotal", "total", "unitprice", "precounitario", "paymentamount"].includes(compact) ||
    /(?:^|\s)(?:valor(?:es)?|amount|preco|price|pagamento)(?:\s|$)/u.test(fieldName)) return "money";
  if (["date", "data", "dates", "datas", "sourcedate", "issuedat", "datadeemissao", "dataemissao"].includes(compact) ||
    /(?:^|\s)(?:data|datas|date|dates|emissao|vencimento)(?:\s|$)/u.test(fieldName)) return "date";
  return "text";
}

function canonicalValue(value: string, type: ReturnType<typeof valueType>) {
  if (type === "money") {
    const plain = value.trim().replace(/^R\$\s*/i, "");
    if (/^-?\d+\.\d{2}$/.test(plain)) return `money:${BigInt(plain.replace(".", ""))}`;
    if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(plain)) return `money:${BigInt(plain.replaceAll(".", "").replace(",", ""))}`;
  }
  if (type === "date") {
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : value.trim();
    if (isValidIsoCalendarDate(iso)) return `date:${iso}`;
  }
  return `text:${normalize(value)}`;
}

function tracedTextValue(text: string, value: string) {
  const normalizedText = normalize(text);
  const normalizedValue = normalize(value);
  if (normalizedText.includes(normalizedValue)) return true;

  // A model may join a literal list with slashes while the original uses
  // pipes, commas or separate columns. Accept the list only when every
  // material member is independently present in the same quoted source.
  // This keeps the trace strict without making punctuation part of the claim.
  const members = normalizedValue
    .split(/\s*(?:\/|\||;|,)\s*/u)
    .map((member) => member.trim())
    .filter((member) => member.length >= 3);
  return members.length >= 2 && members.every((member) => normalizedText.includes(member));
}

/** Format equivalence is allowed only for explicitly monetary/calendar fields.
 * Never coerce identifiers, product variants or quantities into money. */
function tracedValue(source: z.infer<typeof findingSourceObservationSchema>, field: unknown) {
  if (source.value === null) return true;
  const type = valueType(field);
  const value = canonicalValue(source.value, type);
  if (value.startsWith("text:")) return tracedTextValue(source.text, source.value);
  const tokens = type === "date"
    ? source.text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}\/\d{2}\/\d{4}\b/g) ?? []
    : source.text.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, " ")
      .match(/(?<![\p{L}\p{N}.,/])-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\p{L}\p{N}.,/])|(?<![\p{L}\p{N}.,/])-?\d+\.\d{2}(?![\p{L}\p{N}.,/])/gu) ?? [];
  return tokens.some(token => canonicalValue(token, type) === value);
}

export function hasUntracedFindingSourceValue(evidence: Record<string, unknown>) {
  if (evidence.observations === undefined) return false;
  const parsed = z.array(findingSourceObservationSchema).max(MAX_FINDING_SOURCE_OBSERVATIONS).safeParse(evidence.observations);
  return !parsed.success || parsed.data.some(source => !tracedValue(source, evidence.field));
}

/** A monetary conflict must belong to the ordered source pair being reviewed.
 * Equal page numbers do not make SALE, RECEIPT and PAYMENT interchangeable. */
export function hasTracedMonetaryPair(evidence: Record<string, unknown>, quotes: [
  { page: number; source: string; quote: string }, { page: number; source: string; quote: string },
]) {
  const parsed = z.array(findingSourceObservationSchema).min(2).max(MAX_FINDING_SOURCE_OBSERVATIONS).safeParse(evidence.observations);
  if (!parsed.success || valueType(evidence.field) !== "money") return false;
  const matches = (source: z.infer<typeof findingSourceObservationSchema>, quote: typeof quotes[number]) =>
    source.value !== null && source.page === quote.page && source.kind === quote.source.trim().toUpperCase() &&
    tracedValue({ ...source, text: quote.quote }, evidence.field);
  return parsed.data.some((left, index) => matches(left, quotes[0]) && parsed.data.some((right, rightIndex) =>
    rightIndex !== index && matches(right, quotes[1]) &&
    canonicalValue(left.value!, "money") !== canonicalValue(right.value!, "money")));
}

/** Hypotheses can contain agreeing sources before the source that conflicts.
 * Indices select the actual pair, not the first two observations or pages.
 * Every source still needs its own value-bearing quote on the original page. */
export function hasTracedHypothesisPair(evidence: Record<string, unknown>, quotes: { page: number; quote: string }[],
  left: number, right: number, requireConflict: boolean) {
  const parsed = z.array(findingSourceObservationSchema).min(2).max(MAX_FINDING_SOURCE_OBSERVATIONS).safeParse(evidence.observations);
  if (!parsed.success || !Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left === right ||
    !quotes[left] || !quotes[right]) return false;
  const sources = parsed.data;
  const traces = (source: typeof sources[number], quote: typeof quotes[number]) => {
    if (quote.page !== source.page) return false;
    if (source.value !== null) return tracedValue({ ...source, text: quote.quote }, evidence.field);
    const sourceText = normalize(source.text), quotedText = normalize(quote.quote);
    return sourceText.length >= 3 && (quotedText.includes(sourceText) || sourceText.includes(quotedText));
  };
  const claim = (source: typeof sources[number]) => source.value === null
    ? `text:${normalize(source.text)}`
    : canonicalValue(source.value, valueType(evidence.field));
  if (sources.some(source => !quotes.some(quote => traces(source, quote)))) return false;
  return sources.some((a, aIndex) => traces(a, quotes[left]) && sources.some((b, bIndex) => aIndex !== bIndex &&
    traces(b, quotes[right]) && (!requireConflict || claim(a) !== claim(b))));
}

/** Preserve source identity while normalizing only explicitly typed formats. */
export function findingSourceClaims(evidence: Record<string, unknown>) {
  const parsed = z.array(findingSourceObservationSchema).min(2).max(MAX_FINDING_SOURCE_OBSERVATIONS).safeParse(evidence.observations);
  if (!parsed.success || parsed.data.some(source => !source.value || !tracedValue(source, evidence.field))) return null;
  const claims = parsed.data.map(source => ({ value: canonicalValue(source.value!, valueType(evidence.field)), page: source.page, kind: source.kind }));
  return new Set(claims.map(claim => claim.value)).size >= 2 ? claims : null;
}

export function matchingFindingSourceClaims(initial: Record<string, unknown>, verified: Record<string, unknown>) {
  const left = findingSourceClaims(initial);
  const right = findingSourceClaims(verified);
  if (!left || !right) return false;
  const identity = (claim: NonNullable<typeof left>[number]) => JSON.stringify([claim.value, claim.page, claim.kind]);
  const expected = new Set(left.map(identity));
  const actual = new Set(right.map(identity));
  const expectedValues = new Set(left.map(claim => claim.value));
  return [...expected].every(value => actual.has(value)) &&
    right.every(claim => expected.has(identity(claim)) || expectedValues.has(claim.value));
}

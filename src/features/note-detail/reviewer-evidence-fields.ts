export type ReviewerEvidenceField = {
  excerpt: string | null;
  label: string;
  page: number | null;
};

export type ReviewerEvidenceFields = {
  expandLabel: string;
  fields: ReviewerEvidenceField[];
  summary: string;
};

const FIELD_COLLECTION_KEYS = ["fields", "missingFields"] as const;
const FIELD_LABEL_KEYS = ["label", "field", "fieldName", "name"] as const;
const FIELD_PAGE_KEYS = ["page", "pageNumber", "sourcePage"] as const;
const FIELD_EXCERPT_KEYS = [
  "evidence",
  "excerpt",
  "text",
  "snippet",
  "requirementEvidence",
] as const;
const MAX_FIELD_EXCERPT_LENGTH = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstText(value: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate !== "string") continue;
    const text = candidate.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return null;
}

function validPage(value: unknown) {
  const page =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : null;
  return page !== null && Number.isSafeInteger(page) && page > 0 ? page : null;
}

function compactExcerpt(value: string | null) {
  if (!value) return null;
  return value.length <= MAX_FIELD_EXCERPT_LENGTH
    ? value
    : `${value.slice(0, MAX_FIELD_EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function fieldFromEntry(entry: unknown, index: number): ReviewerEvidenceField | null {
  if (typeof entry === "string") {
    const label = entry.replace(/\s+/g, " ").trim();
    return label
      ? { excerpt: null, label, page: null }
      : null;
  }
  if (!isRecord(entry)) return null;

  const label = firstText(entry, FIELD_LABEL_KEYS) ?? `Campo obrigatório ${index + 1}`;
  const excerpt = compactExcerpt(firstText(entry, FIELD_EXCERPT_KEYS));
  const page = FIELD_PAGE_KEYS
    .map((key) => validPage(entry[key]))
    .find((candidate): candidate is number => candidate !== null) ?? null;

  return { excerpt, label, page };
}

/**
 * Builds the reviewer-facing summary and on-demand list for required fields.
 * Only label, positive page and a compact evidence excerpt leave this helper;
 * basis, coordinates, identifiers and other implementation metadata are
 * deliberately ignored.
 */
export function extractReviewerEvidenceFields(
  value: unknown,
): ReviewerEvidenceFields | null {
  if (!isRecord(value)) return null;

  const rawFields = FIELD_COLLECTION_KEYS
    .map((key) => value[key])
    .find(
      (candidate): candidate is unknown[] =>
        Array.isArray(candidate) && candidate.length > 0,
    );
  if (!rawFields?.length) return null;

  const fields = rawFields
    .map((entry, index) => fieldFromEntry(entry, index))
    .filter((field): field is ReviewerEvidenceField => field !== null);
  if (!fields.length) return null;

  const countLabel = fields.length === 1
    ? "campo obrigatório vazio"
    : "campos obrigatórios vazios";
  const examples = fields
    .slice(0, 2)
    .map((field) => field.label)
    .join(" e ");
  const summary = `${fields.length} ${countLabel}.${examples ? ` Exemplos: ${examples}.` : ""}`;

  return {
    expandLabel: fields.length === 1
      ? "Ver o campo"
      : `Ver os ${fields.length} campos`,
    fields,
    summary,
  };
}

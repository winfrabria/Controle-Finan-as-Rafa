export type FindingComparisonLabels = {
  actual: string;
  expected: string;
};

const DEFAULT_LABELS: FindingComparisonLabels = {
  actual: "Encontrado",
  expected: "Esperado",
};

type FindingComparisonInput = {
  actualValue: unknown;
  affectedItem?: unknown;
  category?: string | null;
  code?: string | null;
  evidence?: unknown;
  expectedValue: unknown;
  rule?: {
    code?: string | null;
    description?: string | null;
    id?: string | null;
    name?: string | null;
  } | null;
  title?: string | null;
};

/**
 * Every reviewer surface uses the same two labels. The source-specific names
 * remain in "Onde encontramos", where they explain why each side was chosen.
 */
export function findingComparisonLabels(
  finding: FindingComparisonInput,
): FindingComparisonLabels {
  void finding;
  return DEFAULT_LABELS;
}

export function findingComparisonDifference(
  finding: FindingComparisonInput,
): string | null {
  const structure = normalizeStructure([
    finding.category,
    finding.code,
    finding.title,
    finding.rule?.code,
    finding.rule?.name,
  ]);
  if (/\b(data|date|emissao|issued|periodo|vencimento|validade|due)\b/.test(structure)) {
    const expectedDate = extractComparableDate(finding.expectedValue);
    const actualDate = extractComparableDate(finding.actualValue);
    if (expectedDate === null || actualDate === null) return null;
    const days = Math.round(Math.abs(expectedDate - actualDate) / 86_400_000);
    return days === 0 ? null : `${days} ${days === 1 ? "dia" : "dias"}`;
  }

  if (!/\b(valor|preco|total|pagamento|debito|credito|amount|price|payment)\b/.test(structure)) return null;

  const expected = extractComparableNumber(finding.expectedValue);
  const actual = extractComparableNumber(finding.actualValue);
  if (expected === null || actual === null) return null;

  const difference = Math.abs(expected - actual);
  if (difference < 0.005) return null;

  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(difference);
}

function normalizeStructure(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function extractComparableNumber(value: unknown): number | null {
  const scalar = parseComparableNumber(value);
  if (scalar !== null) return scalar;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entries = Object.entries(value);
  const monetaryValues = uniqueNumbers(
    entries
      .filter(([key]) =>
        /(?:amount|valor|total|price|preco|preço|cost|custo|expected|actual)/i.test(
          key,
        ),
      )
      .flatMap(([, entry]) => collectComparableNumbers(entry)),
  );
  if (monetaryValues.length === 1) return monetaryValues[0] ?? null;

  const allValues = uniqueNumbers(entries.flatMap(([, entry]) => collectComparableNumbers(entry)));
  return allValues.length === 1 ? (allValues[0] ?? null) : null;
}

function collectComparableNumbers(value: unknown, depth = 0): number[] {
  const scalar = parseComparableNumber(value);
  if (scalar !== null) return [scalar];
  if (depth > 2 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectComparableNumbers(entry, depth + 1));
  }
  return Object.values(value).flatMap((entry) =>
    collectComparableNumbers(entry, depth + 1),
  );
}

function extractComparableDate(value: unknown): number | null {
  const values = collectComparableDates(value);
  const unique = [...new Set(values)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

function collectComparableDates(value: unknown, depth = 0): number[] {
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
    const localized = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value.trim());
    const parts = iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : localized
        ? [Number(localized[3]), Number(localized[2]), Number(localized[1])]
        : null;
    if (!parts) return [];
    const [year, month, day] = parts;
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
      ? [timestamp]
      : [];
  }
  if (depth > 2 || !value || typeof value !== "object") return [];
  return Array.isArray(value)
    ? value.flatMap((entry) => collectComparableDates(entry, depth + 1))
    : Object.values(value).flatMap((entry) => collectComparableDates(entry, depth + 1));
}

function parseComparableNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const raw = value.trim().replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (!/^-?\d[\d.,]*$/.test(raw)) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => value.toFixed(6)))].map(Number);
}

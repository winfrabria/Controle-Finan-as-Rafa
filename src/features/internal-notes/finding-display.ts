const moneyKeyPattern =
  /^(?:amount|valor|total|totalAmount|total_amount|price|unitPrice|unit_price|cost|custo|preco|preço)$/i;

const directTextKeys = new Set([
  "text",
  "description",
  "descricao",
  "evidence",
  "evidencia",
]);

const labelOverrides: Record<string, string> = {
  actual: "Encontrado",
  amount: "Valor",
  contract: "Contrato",
  description: "Descrição",
  descricao: "Descrição",
  evidence: "Evidência",
  evidencia: "Evidência",
  expected: "Esperado",
  issuedAt: "Data de emissão",
  item: "Item",
  itemNota: "Item da nota",
  itemTotalSum: "Soma dos itens",
  limit: "Limite",
  lineNumber: "Linha",
  motivo: "Motivo",
  noteTotal: "Total da nota",
  period: "Período",
  quantity: "Quantidade",
  reference: "Referência",
  referencia: "Referência",
  reason: "Motivo",
  ruleCode: "Código da regra",
  software: "Sistema",
  source: "Fonte",
  text: "Evidência",
  total: "Total",
  totalAmount: "Valor total",
  unit: "Unidade",
  unitPrice: "Valor unitário",
  valor: "Valor",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNumber(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const normalized = value.trim().replace(/R\$\s*/i, "");
  if (!normalized) return null;

  const brazilian = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)
      ? normalized.replace(/\./g, "")
      : normalized;
  const parsed = Number(brazilian);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: string | number) {
  const parsed = parseNumber(value);
  return parsed === null
    ? String(value)
    : new Intl.NumberFormat("pt-BR", {
        currency: "BRL",
        style: "currency",
      }).format(parsed);
}

function labelForKey(key: string) {
  return labelOverrides[key] ?? humanizeFindingKey(key);
}

function formatScalar(value: unknown, key?: string) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const normalized = value.trim().replace(/R\$\s*/i, "");
    const looksLikeMoney =
      /^-?\d+[.,]\d{2}$/.test(normalized) ||
      /^-?\d{1,3}(?:\.\d{3})+$/.test(normalized);
    return ((key && moneyKeyPattern.test(key)) || (!key && looksLikeMoney)) &&
      parseNumber(value) !== null
      ? formatMoney(value)
      : value;
  }
  if (typeof value === "number") {
    return key && moneyKeyPattern.test(key) ? formatMoney(value) : String(value);
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return null;
}

function formatNested(value: unknown, fallback: string, depth: number): string {
  const scalar = formatScalar(value);
  if (scalar !== null) return scalar;
  if (depth > 2) return fallback;
  if (Array.isArray(value)) {
    const entries = value
      .map((item) => formatNested(item, "", depth + 1))
      .filter(Boolean);
    return entries.length ? entries.join(", ") : fallback;
  }
  if (!isRecord(value)) return fallback;

  const entries = Object.entries(value)
    .slice(0, 8)
    .map(([key, entry]) => formatEntry(key, entry, depth + 1))
    .filter(Boolean);
  return entries.length ? entries.join(" · ") : fallback;
}

function formatEntry(key: string, value: unknown, depth: number) {
  const scalar = formatScalar(value, key);
  const formatted = scalar ?? formatNested(value, "—", depth);
  if (!formatted) return "";

  // Evidence payloads commonly wrap the sentence in `{ text: "..." }`.
  // Showing the sentence itself is clearer than exposing an implementation key.
  if (directTextKeys.has(key) && typeof value === "string") return formatted;
  return `${labelForKey(key)}: ${formatted}`;
}

export function humanizeFindingKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

/**
 * Converts finding JSON into a compact, human-readable value for the UI.
 * Money fields are localized while identifiers and quantities remain untouched.
 */
export function formatFindingValue(value: unknown, fallback = "Não informado") {
  if (value === null || value === undefined) return fallback;
  const scalar = formatScalar(value);
  if (scalar !== null) return scalar;
  return formatNested(value, fallback, 0);
}

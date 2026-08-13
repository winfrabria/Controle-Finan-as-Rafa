const moneyKeyPattern =
  /^(?:amount|valor|total|totalAmount|total_amount|price|unitPrice|unit_price|cost|custo|preco|preço|aggregateTotal|supportingTotal|unsupportedAmount)$/i;

const directTextKeys = new Set([
  "text",
  "description",
  "descricao",
  "evidence",
  "evidencia",
]);

const labelOverrides: Record<string, string> = {
  actual: "Encontrado",
  aggregateDescription: "Cobrança informada",
  aggregateTotal: "Valor cobrado",
  amount: "Valor",
  contract: "Contrato",
  description: "Descrição",
  descricao: "Descrição",
  evidence: "Evidência",
  evidencia: "Evidência",
  expected: "Esperado",
  issuedAt: "Data de emissão",
  item: "Item",
  items: "Itens",
  itemNota: "Item da nota",
  itemTotalSum: "Soma dos itens",
  matchedTerm: "Termo identificado",
  field: "Campo",
  fieldName: "Campo",
  excerpt: "Trecho do documento",
  page: "Página",
  pageNumber: "Página",
  path: "Campo",
  limit: "Limite",
  lineNumber: "Item",
  documentGroup: "Documento relacionado",
  duplicateNoteId: "Anexo semelhante",
  fields: "Campos não preenchidos",
  motivo: "Motivo",
  noteTotal: "Total da nota",
  period: "Período",
  reconciliationBasis: "Base da conciliação",
  quantity: "Quantidade",
  reference: "Referência",
  referencia: "Referência",
  reason: "Motivo",
  ruleCode: "Código da regra",
  software: "Sistema",
  source: "Fonte",
  summary: "Resumo da evidência",
  supplierName: "Fornecedor",
  supplierTaxId: "CNPJ do fornecedor",
  supportingDocumentCount: "Documentos encontrados",
  supportingTotal: "Valor comprovado",
  text: "Evidência",
  total: "Total",
  totalAmount: "Valor total",
  tolerance: "Tolerância",
  unit: "Unidade",
  unitPrice: "Valor unitário",
  unsupportedAmount: "Valor sem documento no anexo",
  valor: "Valor",
};

const technicalTextLabels: Record<string, string> = {
  duplicateNoteId: "anexo semelhante",
  fieldName: "campo",
  insuredAge: "idade do segurado",
  issuedAt: "data de emissão",
  itemTotalSum: "soma dos itens",
  lineNumber: "item",
  noteTotal: "total da nota",
  pageNumber: "página",
  supplierName: "fornecedor",
  supplierTaxId: "CNPJ do fornecedor",
  superName: "nome do responsável",
  superTexture: "descrição do documento",
  totalAmount: "valor total",
  unitPrice: "valor unitário",
};

export type FindingDisplayPart = {
  label: string;
  value: string;
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

function formatFieldPath(value: string) {
  return value
    .split(/\s*,\s*/)
    .map((path) =>
      path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean)
        .map((part) =>
          /^\d+$/.test(part) ? `item ${Number(part) + 1}` : labelForKey(part),
        )
        .join(" › "),
    )
    .join(" • ");
}

function formatEvidenceSource(value: string) {
  const sources: Record<string, string> = {
    invoice: "Dados extraídos do documento",
    "invoice.markdown": "Conteúdo extraído do documento",
    "invoice.pdf": "Documento enviado",
    markdown: "Conteúdo extraído do documento",
    pdf: "Documento enviado",
  };
  return sources[value.trim().toLocaleLowerCase("pt-BR")] ?? value;
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
 * Rewrites implementation-oriented field names that may appear inside model
 * prose before the text reaches a reviewer-facing screen.
 */
export function humanizeFindingText(value: string) {
  return Object.entries(technicalTextLabels).reduce((text, [key, label]) => {
    const snakeCaseKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    return text
      .replace(new RegExp(`\\b${key}\\b`, "g"), label)
      .replace(new RegExp(`\\b${snakeCaseKey}\\b`, "gi"), label);
  }, value);
}

/**
 * Breaks compact object summaries into readable lines for comparison cards.
 * The formatter keeps ordinary prose intact and only splits the separators
 * produced by `formatFindingValue` or explicit line breaks.
 */
export function formatFindingValueLines(value: string) {
  return value
    .split(/\r?\n|\s+·\s+/)
    .map((part) => humanizeFindingText(part).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Reduces long evidence paths to the items and fields a reviewer actually
 * needs to locate, while the complete path remains available in the detail.
 */
export function compactFindingFieldPath(value: string) {
  const itemNumbers = [
    ...new Set(
      [...value.matchAll(/item\s+(\d+)/gi)].map((match) => match[1]),
    ),
  ];
  const normalized = value.toLocaleLowerCase("pt-BR");
  const fieldLabels = ["Quantidade", "Valor unitário", "Valor total"].filter(
    (label) => normalized.includes(label.toLocaleLowerCase("pt-BR")),
  );

  if (itemNumbers.length === 0 || fieldLabels.length === 0) return value;

  const itemLabel = itemNumbers.length === 1 ? "Item" : "Itens";
  return `${itemLabel} ${itemNumbers.join(" e ")} • ${fieldLabels.join(", ")}`;
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

/**
 * Produces label/value pairs for evidence cards so technical JSON keys such as
 * `page` and `field` never leak directly into the reviewer interface.
 */
export function formatFindingParts(
  value: unknown,
  fallback = "Evidência registrada",
): FindingDisplayPart[] {
  if (value === null || value === undefined) return [];

  if (!isRecord(value)) {
    return [{ label: "Evidência", value: formatFindingValue(value, fallback) }];
  }

  return Object.entries(value)
    .slice(0, 10)
    .map(([key, entry]) => {
      const formatted =
        typeof entry === "string" && /^(?:field|fieldName|path)$/i.test(key)
          ? formatFieldPath(entry)
          : typeof entry === "string" && key === "source"
            ? formatEvidenceSource(entry)
          : formatScalar(entry, key) ?? formatNested(entry, fallback, 1);

      return {
        label:
          directTextKeys.has(key) || key === "excerpt"
            ? key === "excerpt"
              ? "Trecho do documento"
              : "Evidência"
            : labelForKey(key),
        value: formatted || fallback,
      };
    })
    .filter((part) => part.value);
}

const moneyKeyPattern =
  /^(?:amount|valor|total|totalAmount|total_amount|noteTotal|itemTotalSum|price|unitPrice|unit_price|cost|custo|preco|preço|aggregateTotal|supportingTotal|unsupportedAmount)$/i;

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

const reviewerHiddenLabels = new Set([
  "Base da conciliação",
  "Código da regra",
  "Documento relacionado",
  "Observations",
  "Observações",
  "Tolerância",
]);

const reviewerTechnicalKeys = new Set([
  "boundingbox",
  "comparisonmode",
  "documentgroup",
  "documentrole",
  "reconciliationbasis",
  "referencebasis",
  "requirementbasis",
  "requirementevidence",
  "rulecode",
]);

export type FindingComparisonMode = "REFERENCE" | "CONFLICT";

export function findingComparisonMetadata(
  evidence: unknown,
  _expectedValue: unknown,
): {
  comparisonMode: FindingComparisonMode;
  referenceBasis: string | null;
} {
  // Mantido no contrato público para compatibilidade com os chamadores
  // legados; a presença isolada de expectedValue não prova uma referência.
  void _expectedValue;
  const rawMode = isRecord(evidence) ? evidence.comparisonMode : null;
  const rawBasis = isRecord(evidence) ? evidence.referenceBasis : null;
  const fields = isRecord(evidence) && Array.isArray(evidence.fields)
    ? evidence.fields
    : [];
  const explicitFieldBasis = fields
    .map((field) =>
      isRecord(field) && typeof field.requirementBasis === "string"
        ? field.requirementBasis.trim()
        : "",
    )
    .find((basis) => basis === "EXPLICIT_DOCUMENT" || basis === "VERIFIED_POLICY");

  return {
    comparisonMode:
      rawMode === "REFERENCE" || rawMode === "CONFLICT"
        ? rawMode
        : explicitFieldBasis
          ? "REFERENCE"
          : "CONFLICT",
    referenceBasis:
      typeof rawBasis === "string" && rawBasis.trim()
        ? rawBasis.trim()
        : explicitFieldBasis || null,
  };
}

const reviewerLabelOverrides: Record<string, string> = {
  "Soma dos itens": "Soma dos itens considerados",
  "Total da nota": "Total do documento",
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
 * Keeps reviewer-facing prose free from internal document-group identifiers.
 * ADMIN screens continue to use `humanizeFindingText` and retain the raw code.
 */
export function humanizeReviewerFindingText(value: string) {
  return humanizeFindingText(value)
    .replace(
      /\bao\s+(?:documento relacionado|grupo(?: documental)?|document group)\s*[:#-]?\s*D\d{1,4}\b/gi,
      "aos documentos da mesma despesa",
    )
    .replace(
      /\b(?:documento relacionado|grupo(?: documental)?|document group)\s*[:#-]?\s*D\d{1,4}\b/gi,
      "documentos da mesma despesa",
    )
    .replace(/\bD\d{1,4}\b/gi, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Breaks compact object summaries into readable lines for comparison cards.
 * The formatter keeps ordinary prose intact and only splits the separators
 * produced by `formatFindingValue` or explicit line breaks.
 */
export function formatFindingValueLines(value: string) {
  const lines = value
    .split(/\r?\n|\s+·\s+|\s+×\s+/)
    .map((part) =>
      humanizeFindingText(part)
        .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  if (lines.length <= 5) return lines;
  return [
    ...lines.slice(0, 4),
    `Mais ${lines.length - 4} valores no documento`,
  ];
}

export type ReviewerFindingIdentity = {
  category?: string | null;
  code?: string | null;
  field?: string | null;
  title?: string | null;
};

export type ReviewerFindingValueDimension = "amount" | "date" | "generic";

export type ReviewerConflictValueSource = {
  label?: string | null;
  value?: unknown;
};

export type ReviewerConflictValueCard = {
  label: string;
  lines: string[];
};

/**
 * Chooses the evidence dimension before a source is attached to a card. This
 * prevents a date finding whose observations also carry an amount from
 * displaying the amount as if it were the compared value.
 */
export function reviewerFindingValueDimension(
  identity: ReviewerFindingIdentity = {},
): ReviewerFindingValueDimension {
  const normalize = (value: string | null | undefined) =>
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_./-]+/g, " ")
      .toLocaleLowerCase("pt-BR");
  const field = normalize(identity.field);
  const fieldDate =
    /\b(datas?|dates?|emissao|emission|issued|vencimento|validade|periodo|prazo|due|expiry)\b/u.test(
      field,
    );
  const fieldAmount =
    /\b(valores?|amounts?|precos?|prices?|totais?|pagamento|payment|desconto|discount|custo|cost)\b/u.test(
      field,
    );
  if (fieldDate && !fieldAmount) return "date";
  if (fieldAmount && !fieldDate) return "amount";

  const structure = normalize(
    [identity.category, identity.code, identity.title].join(" "),
  );
  const dateSignals = structure.match(
    /\b(datas?|dates?|emissao|emission|issued|vencimento|validade|periodo|prazo|due|expiry)\b/gu,
  )?.length ?? 0;
  const amountSignals = structure.match(
    /\b(valores?|amounts?|precos?|prices?|totais?|pagamento|payment|desconto|discount|custo|cost)\b/gu,
  )?.length ?? 0;
  if (dateSignals > amountSignals && dateSignals > 0) return "date";
  if (amountSignals > 0) return "amount";
  return "generic";
}

/**
 * Reads only the dimension selected by the finding identity. `undefined`
 * means that this source did not provide the compared dimension and must not
 * inherit an unrelated fallback value.
 */
export function reviewerObservationValue(
  observation: {
    amount?: unknown;
    date?: unknown;
    firstDate?: unknown;
    totalAmount?: unknown;
  },
  identity: ReviewerFindingIdentity = {},
) {
  const dimension = reviewerFindingValueDimension(identity);
  if (dimension === "date") {
    return observation.firstDate ?? observation.date ?? undefined;
  }
  if (dimension === "amount") {
    return observation.totalAmount ?? observation.amount ?? undefined;
  }
  return observation.amount ?? observation.date ?? undefined;
}

function compactReviewerLine(value: string, maxLength = 150) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function requiredFieldExamples(value: string) {
  const explicitLabels = [
    ...value.matchAll(/\b(?:label|campo)\s*[:=]\s*([^,;·|\n]+)/giu),
  ].map((match) => match[1]);
  const rawCandidates = explicitLabels.length > 0
    ? explicitLabels
    : value.split(/\r?\n|\s+·\s+|\s*[,;|]\s*/u);
  const unique = new Map<string, string>();

  for (const rawCandidate of rawCandidates) {
    const candidate = rawCandidate
      .replace(/\[[^\]]*(?:vazi|empty)[^\]]*\]/giu, "")
      .replace(/\bpágina\s*\d+\b/giu, "")
      .replace(/^(?:encontrado|campos? (?:obrigatórios? )?(?:não preenchidos?|vazios?))\s*:?\s*/iu, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s:.-]+|[\s:.-]+$/g, "")
      .trim();
    const normalized = candidate.toLocaleLowerCase("pt-BR");
    if (
      candidate.length < 2 ||
      candidate.length > 80 ||
      /^(?:campos? obrigatórios? preenchidos?|não informado|sem referência)$/iu.test(candidate)
    ) continue;
    if (!unique.has(normalized)) unique.set(normalized, candidate);
  }

  return [...unique.values()];
}

/**
 * Keeps comparison cards concise for financial reviewers. Long lists of
 * mandatory fields are summarized with a count and two examples, while other
 * provider prose is capped per line. The complete evidence remains available
 * in the evidence panel and raw ADMIN log.
 */
export function formatReviewerFindingValueLines(
  value: string,
  identity: ReviewerFindingIdentity = {},
) {
  const semanticIdentity = `${identity.code ?? ""} ${identity.category ?? ""} ${identity.field ?? ""} ${identity.title ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  if (
    /(?:campo|field).*(?:obrigator|required|mandatory|preench|vazi|missing)|(?:obrigator|required|mandatory).*(?:campo|field)/u.test(
      semanticIdentity,
    )
  ) {
    const fields = requiredFieldExamples(value);
    if (fields.length >= 3) {
      return [
        `${fields.length} campos obrigatórios vazios`,
        `Exemplos: ${fields.slice(0, 2).join(" e ")}`,
      ];
    }
  }

  const isAmountComparison =
    reviewerFindingValueDimension(identity) === "amount" ||
    /(?:amounts?|valores?|prices?|precos?|totais?)/u.test(semanticIdentity);
  const lines = formatFindingValueLines(value).map((line) => {
    const compact = compactReviewerLine(line);
    return isAmountComparison && /^(?:R\$\s*)?-?\d+(?:[.,]\d{2})$/u.test(compact)
      ? formatMoney(compact)
      : compact;
  });

  return [...new Set(lines)];
}

export function formatReviewerConflictValueLines(
  actualValue: unknown,
  expectedValue: unknown,
  identity: ReviewerFindingIdentity = {},
) {
  return uniqueReviewerConflictLines(
    [actualValue, expectedValue].flatMap((value) =>
      formatReviewerConflictValue(value, identity),
    ),
  );
}

/**
 * Splits a conflict into neutral value cards. A conflict has no proven
 * expected side, so the two input values are treated as observations only.
 * Source labels are optional and are supplied by the UI when evidence carries
 * a document kind such as Ficha, Pagamento or Recibo.
 */
export function formatReviewerConflictValueCards(
  actualValue: unknown,
  expectedValue: unknown,
  identity: ReviewerFindingIdentity = {},
  sources: ReviewerConflictValueSource[] = [],
): ReviewerConflictValueCard[] {
  const fallbackLines = uniqueReviewerConflictLines(
    [actualValue, expectedValue].flatMap((value) =>
      formatReviewerConflictValue(value, identity),
    ),
  );
  const usedLines = new Set<string>();
  const cards: ReviewerConflictValueCard[] = [];
  let fallbackIndex = 0;

  for (const source of sources) {
    const lines = source.value === undefined
      ? []
      : uniqueReviewerConflictLines(
          formatReviewerConflictValue(source.value, identity),
        );

    if (lines.length === 0) continue;

    for (const line of lines) {
      const matchingFallback = fallbackLines.find(
        (candidate) =>
          reviewerConflictLineKey(candidate) === reviewerConflictLineKey(line),
      );
      usedLines.add(
        reviewerConflictLineKey(matchingFallback ?? line),
      );
    }

    const sourceLabel = source.label?.trim();
    if (!sourceLabel) fallbackIndex += 1;
    cards.push({
      label: sourceLabel || reviewerConflictFallbackLabel(identity, fallbackIndex),
      lines,
    });
  }

  for (const line of fallbackLines) {
    if (usedLines.has(reviewerConflictLineKey(line))) continue;
    cards.push({
      label: reviewerConflictFallbackLabel(identity, fallbackIndex + 1),
      lines: [line],
    });
    fallbackIndex += 1;
  }

  return mergeReviewerConflictCards(cards);
}

function reviewerConflictFallbackLabel(
  identity: ReviewerFindingIdentity,
  index: number,
) {
  return `${reviewerFindingValueDimension(identity) === "date" ? "Data" : "Valor"} encontrado ${index}`;
}

function formatReviewerConflictValue(
  value: unknown,
  identity: ReviewerFindingIdentity,
): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (
    typeof value === "string" &&
    /^(?:sem\s+refer[eê]ncia(?:\s+compar[aá]vel)?|n[aã]o\s+informado|n[aã]o\s+identificado|[-—])\.?$/iu.test(
      value.trim(),
    )
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => formatReviewerConflictValue(entry, identity));
  }

  const semanticIdentity = `${identity.code ?? ""} ${identity.category ?? ""} ${identity.field ?? ""} ${identity.title ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const formattedValue =
    typeof value === "number" &&
    (reviewerFindingValueDimension(identity) === "amount" ||
      /(?:amounts?|valores?|precos?|prices?|totais?|pagamento|payment)/u.test(semanticIdentity))
      ? formatMoney(value)
      : formatFindingValue(value);
  const formatted = formatReviewerFindingValueLines(
    formattedValue,
    identity,
  );
  return formatted.flatMap((line) =>
    line
      .split(/\r?\n|\s+×\s+|\s+·\s+|,\s+(?=R\$\s*)/u)
      .map((part) => part.replace(/[ \t\r\n]+/g, " ").trim())
      .filter(Boolean),
  );
}

function uniqueReviewerConflictLines(lines: string[]) {
  const unique = new Map<string, string>();
  for (const line of lines) {
    const normalized = reviewerConflictLineKey(line);
    if (normalized && !unique.has(normalized)) unique.set(normalized, line);
  }
  return [...unique.values()];
}

function reviewerConflictLineKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeReviewerConflictCards(cards: ReviewerConflictValueCard[]) {
  const merged: ReviewerConflictValueCard[] = [];

  for (const card of cards) {
    const existing = merged.find(
      (candidate) =>
        candidate.lines.length === card.lines.length &&
        candidate.lines.every(
          (line, index) =>
            reviewerConflictLineKey(line) ===
            reviewerConflictLineKey(card.lines[index]!),
        ),
    );
    if (!existing) {
      merged.push({ ...card, lines: [...card.lines] });
      continue;
    }

    const labels = new Set(existing.label.split(" / ").map((label) => label.trim()));
    if (card.label && !labels.has(card.label)) {
      existing.label = `${existing.label} / ${card.label}`;
    }
  }

  return merged;
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

/**
 * Keeps implementation details available to the ADMIN raw log while removing
 * fields that do not help a financial reviewer decide where the divergence is.
 */
export function formatReviewerFindingParts(
  value: unknown,
  fallback = "Evidência registrada",
): FindingDisplayPart[] {
  if (!isRecord(value)) {
    return formatFindingParts(value, fallback)
      .filter((part) => !reviewerHiddenLabels.has(part.label))
      .map((part) => ({
        ...part,
        label: reviewerLabelOverrides[part.label] ?? part.label,
      }));
  }

  const reviewerValue = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !reviewerTechnicalKeys.has(key.replace(/[^a-z]/gi, "").toLowerCase()),
    ),
  );
  const parts = formatFindingParts(reviewerValue, fallback)
    .filter((part) => !reviewerHiddenLabels.has(part.label))
    .map((part) => ({
      ...part,
      label: reviewerLabelOverrides[part.label] ?? part.label,
    }));

  const fields = Array.isArray(value.fields) ? value.fields : [];
  if (fields.length === 0) return parts;

  const labels = fields
    .map((field) => {
      if (typeof field === "string") return field.trim();
      if (!isRecord(field)) return "";
      const label = field.label ?? field.field ?? field.fieldName;
      return typeof label === "string" ? label.trim() : "";
    })
    .filter(Boolean);
  const examples = [...new Set(labels)].slice(0, 2);
  const fieldSummary = `${fields.length} ${fields.length === 1 ? "campo obrigatório vazio" : "campos obrigatórios vazios"}${
    examples.length ? `. Exemplos: ${examples.join(" e ")}.` : "."
  }`;

  return [
    ...parts.filter((part) => part.label !== "Campos não preenchidos"),
    { label: "Campos não preenchidos", value: fieldSummary },
  ];
}

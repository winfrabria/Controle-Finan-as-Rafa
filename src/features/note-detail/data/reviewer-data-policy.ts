import type { Prisma } from "@/generated/prisma/client";

const RESTRICTED_KEY_PATTERN =
  /(?:^|_)(?:confidence|confianca|probability|probabilidade|cost_?usd|ai_?cost|model_?cost|provider_?cost|custo_?(?:da_?)?ia|custo_?(?:do_?)?processamento|tokens?|prompt|raw_?response|resposta_?bruta|document_?role|document_?group|bounding_?box|requirement_?(?:basis|evidence)|comparison_?mode|reference_?basis|reconciliation_?basis|rule_?code|provider|provedor|request_?id|route|rota|reasoning|raciocinio|signed_?(?:url|link)|presigned_?(?:url|link)|url_?(?:assinad[ao]|temporari[ao]))(?:_|$)/i;
const RESTRICTED_MARKDOWN_LINE_PATTERN =
  /^\s*["']?(?:confidence|confian[çc]a|probability|probabilidade|cost[ _-]?usd|ai[ _-]?cost|model[ _-]?cost|provider[ _-]?cost|custo[ _-]?(?:da[ _-]?)?(?:ia|processamento)|tokens?|prompt|raw[ _-]?response|resposta[ _-]?bruta|document[ _-]?(?:role|group)|bounding[ _-]?box|requirement[ _-]?(?:basis|evidence)|comparison[ _-]?mode|reference[ _-]?basis|reconciliation[ _-]?basis|rule[ _-]?code|provider|provedor|request[ _-]?id|route|rota|reasoning|racioc[ií]nio|signed[ _-]?(?:url|link)|presigned[ _-]?(?:url|link)|url[ _-]?(?:assinad[ao]|temporari[ao]))["']?\s*[:=]/i;
const RESTRICTED_TEXT_PATTERNS = [
  /(?:read\s*)?(?:confidence|confianca|confiança|probability|probabilidade)(?:\s*(?:da\s+leitura|score|nível|nivel))?\s*[:=\-]?\s*(?:\d+(?:[.,]\d+)?%?|alta|média|media|baixa)?/gi,
  /(?:custo\s+(?:da\s+)?(?:ia|api|modelo|processamento)|cost\s*(?:usd)?|provider\s+cost)\s*[:=\-]?\s*(?:(?:US)?\$\s*)?\d+(?:[.,]\d+)?/gi,
  /(?:(?:prompt|completion|total)\s*)?tokens?\s*[:=\-]?\s*\d+/gi,
  /(?:system\s+prompt|prompt(?:\s+(?:do\s+)?sistema)?)\s*[:=\-]?\s*[^.;\n]*/gi,
  /(?:raw\s*response|resposta\s+bruta)\s*[:=\-]?\s*[^.;\n]*/gi,
  /["']?\b(?:provider|provedor|request\s*[_-]?\s*id|route|rota|reasoning|racioc[ií]nio)\b["']?\s*[:=]\s*[^,.;\n]*/gi,
  /\b(?:provider|provedor|request\s*[_-]?\s*id|reasoning|racioc[ií]nio)\b\s+(?=["']?(?:openai|openrouter|api|zdr|internal|interno|req(?:uest)?[-_ ]?\d+|modelo|model|secreto|secret)\b)[^,.;\n]*/gi,
  /\b(?:route|rota)\b\s+(?=["']?(?:openai|openrouter|api|zdr|internal|interno|req(?:uest)?[-_ ]?\d+|modelo|model)\b)[^,.;\n]*/gi,
  /https?:\/\/[^\s"'<>]*(?:[?&](?:token|signature|sig|expires|expiration|access_?token|auth|x[-_]?(?:amz|goog)[-_][^=&#\s]+)=[^\s&"'<>]*)[^\s"'<>]*/gi,
] as const;
const FRIENDLY_FIELD_PATTERNS: Array<[RegExp, string]> = [
  [/\bsupplierName\b/gi, "nome do fornecedor"],
  [/\bsupplierTaxId\b/gi, "CNPJ do fornecedor"],
  [/\bissuedAt\b/gi, "data do documento"],
  [/\bdocumentNumber\b/gi, "número do documento"],
  [/\btotalAmount\b/gi, "valor total"],
  [/\blineNumber\b/gi, "item"],
  [/\bextractedData\b/gi, "dados extraídos"],
  [/\bsuperName\b/gi, "nome do responsável"],
  [/\bsuperTexture\b/gi, "descrição do documento"],
  [/\binsuredAge\b/gi, "idade informada"],
  [/\bsuper_name\b/gi, "nome do responsável"],
  [/\bsuper_texture\b/gi, "descrição do documento"],
  [/\binsured_age\b/gi, "idade informada"],
  [/\binvoice\b/gi, "documento"],
];

export function sanitizeReviewerText(value: string) {
  const withoutRestrictedData = RESTRICTED_TEXT_PATTERNS.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, "informação técnica restrita"),
    value,
  );
  return FRIENDLY_FIELD_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    withoutRestrictedData,
  );
}

const REVIEWER_DOCUMENT_LINK_KEYS = new Set([
  "documenturl",
  "document_url",
  "documentlink",
  "document_link",
  "documenthref",
  "document_href",
]);

export function sanitizeReviewerMarkdown(value: string | null) {
  if (!value) return null;

  const visibleLines = value
    .split(/\r?\n/)
    .filter((line) => !RESTRICTED_MARKDOWN_LINE_PATTERN.test(line))
    .map(sanitizeReviewerText)
    .filter((line) => line.trim());

  return visibleLines.length ? visibleLines.join("\n") : null;
}

export type ReviewerJsonSanitizeOptions = {
  preserveDocumentUrl?: boolean;
};

export function sanitizeReviewerJson(
  value: Prisma.JsonValue | null,
  options: ReviewerJsonSanitizeOptions = {},
): Prisma.JsonValue | null {
  return sanitizeReviewerJsonValue(
    value,
    undefined,
    0,
    options.preserveDocumentUrl !== false,
  );
}

function sanitizeReviewerJsonValue(
  value: Prisma.JsonValue | null,
  key: string | undefined,
  depth: number,
  preserveDocumentUrl: boolean,
): Prisma.JsonValue | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const normalizedKey = key?.replace(/[^a-z_]/gi, "").toLowerCase();
    return preserveDocumentUrl &&
      depth === 0 &&
      normalizedKey &&
      REVIEWER_DOCUMENT_LINK_KEYS.has(normalizedKey)
      ? value
      : sanitizeReviewerText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeReviewerJsonValue(item, undefined, depth + 1, preserveDocumentUrl),
    );
  }

  const sanitized: Record<string, Prisma.JsonValue> = {};

  for (const [key, item] of Object.entries(value)) {
    if (isRestrictedReviewerKey(key)) continue;
    if (item === undefined) continue;
    sanitized[key] = sanitizeReviewerJsonValue(
      item,
      key,
      typeof item === "object" && item !== null ? depth + 1 : depth,
      preserveDocumentUrl,
    ) as Prisma.JsonValue;
  }

  return sanitized;
}

function isRestrictedReviewerKey(key: string) {
  const normalized = key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return RESTRICTED_KEY_PATTERN.test(normalized);
}

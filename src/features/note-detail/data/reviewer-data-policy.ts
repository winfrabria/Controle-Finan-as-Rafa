import type { Prisma } from "@/generated/prisma/client";

const RESTRICTED_KEY_PATTERN =
  /confidence|confianca|confiança|probability|probabilidade|cost_?usd|ai_?cost|model_?cost|provider_?cost|custo_?(?:da_?)?ia|custo_?(?:do_?)?processamento|tokens?|prompt|raw_?response|resposta_?bruta/i;
const RESTRICTED_TEXT_PATTERNS = [
  /(?:read\s*)?(?:confidence|confianca|confiança|probability|probabilidade)(?:\s*(?:da\s+leitura|score|nível|nivel))?\s*[:=\-]?\s*(?:\d+(?:[.,]\d+)?%?|alta|média|media|baixa)?/gi,
  /(?:custo\s+(?:da\s+)?(?:ia|api|modelo|processamento)|cost\s*(?:usd)?|provider\s+cost)\s*[:=\-]?\s*(?:(?:US)?\$\s*)?\d+(?:[.,]\d+)?/gi,
  /(?:(?:prompt|completion|total)\s*)?tokens?\s*[:=\-]?\s*\d+/gi,
  /(?:system\s+prompt|prompt(?:\s+(?:do\s+)?sistema)?)\s*[:=\-]?\s*[^.;\n]*/gi,
  /(?:raw\s*response|resposta\s+bruta)\s*[:=\-]?\s*[^.;\n]*/gi,
] as const;

export function sanitizeReviewerText(value: string) {
  return RESTRICTED_TEXT_PATTERNS.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, "informação técnica restrita"),
    value,
  );
}

export function sanitizeReviewerMarkdown(value: string | null) {
  if (!value) return null;

  const visibleLines = value
    .split(/\r?\n/)
    .filter((line) => !RESTRICTED_KEY_PATTERN.test(line));

  return visibleLines.length ? visibleLines.join("\n") : null;
}

export function sanitizeReviewerJson(
  value: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  if (value === null) return null;
  if (typeof value === "string") return sanitizeReviewerText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReviewerJson(item));
  }

  const sanitized: Record<string, Prisma.JsonValue> = {};

  for (const [key, item] of Object.entries(value)) {
    if (RESTRICTED_KEY_PATTERN.test(key)) continue;
    if (item === undefined) continue;
    sanitized[key] = sanitizeReviewerJson(item) as Prisma.JsonValue;
  }

  return sanitized;
}

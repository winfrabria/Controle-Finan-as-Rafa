import type { Prisma } from "@/generated/prisma/client";

const RESTRICTED_KEY_PATTERN =
  /confidence|confianca|confiança|probability|probabilidade/i;
const RESTRICTED_TEXT_PATTERN =
  /(?:read\s*)?(?:confidence|confianca|confiança|probability|probabilidade)(?:\s*(?:da\s+leitura|score|nível|nivel))?\s*[:=\-]?\s*(?:\d+(?:[.,]\d+)?%?|alta|média|media|baixa)?/gi;

export function sanitizeReviewerText(value: string) {
  return value.replace(RESTRICTED_TEXT_PATTERN, "indicador restrito");
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

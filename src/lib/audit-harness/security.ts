const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "chainofthought",
  "reasoning",
  "reasoningdetails",
  "signedurl",
]);

const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/giu, "[REDACTED_PRIVATE_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]"],
  [
    /\b(?:api[_ -]?key|authorization|private[_ -]?key)\s*[:=]\s*[^\r\n,;}]*/giu,
    "[REDACTED_CREDENTIAL]",
  ],
  [
    /\b(?:chain[_ -]?of[_ -]?thought|reasoning(?:[_ -]?details)?)\s*[:=]\s*[^\r\n]*/giu,
    "[REDACTED_REASONING]",
  ],
  [
    /https?:\/\/[^\s"'<>]*(?:[?&](?:token|access_token|signature|sig|key|x-amz-[^=]*)=)[^\s"'<>]*/giu,
    "[REDACTED_SIGNED_URL]",
  ],
];

function sanitizeText(value: string) {
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    value,
  );
}

export function sanitizeForPersistence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForPersistence);
  if (typeof value === "string") return sanitizeText(value);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEYS.has(key.replace(/[_-]/g, "").toLowerCase()))
      .map(([key, nested]) => [key, sanitizeForPersistence(nested)]),
  );
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "authorization",
  "chainofthought",
  "reasoning",
  "reasoningdetails",
  "signedurl",
]);

export function sanitizeForPersistence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForPersistence);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEYS.has(key.replace(/[_-]/g, "").toLowerCase()))
      .map(([key, nested]) => [key, sanitizeForPersistence(nested)]),
  );
}

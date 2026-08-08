export const HARNESS_VERSIONS = {
  policy: "2026-08-08.1",
  prompt: "2026-08-01.1",
  schema: "2026-08-01.1",
  rules: "2026-08-01.1",
} as const;

export const HARNESS_MODEL = "openai/gpt-5.6-luna" as const;
export const HARNESS_PDF_MODEL = "openai/gpt-5.6-luna" as const;

/**
 * The MVP uses Luna as the single evaluator. Older deployments still have
 * `openai/gpt-5.6-sol` in their PDF/model environment variables, so treat
 * that value as a legacy alias instead of silently routing new uploads to a
 * different model.
 */
export function resolveHarnessModel(
  configured: string | undefined,
  fallback: string = HARNESS_MODEL,
) {
  const model = configured?.trim();
  if (!model || model === "openai/gpt-5.6-sol") return fallback;
  return model;
}

export function resolvePdfModel(configured: string | undefined) {
  return resolveHarnessModel(configured, HARNESS_PDF_MODEL);
}

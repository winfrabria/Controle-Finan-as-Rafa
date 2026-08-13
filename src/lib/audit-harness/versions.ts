export const HARNESS_VERSIONS = {
  policy: "2026-08-13.3",
  prompt: "2026-08-13.3",
  schema: "2026-08-13.3",
  rules: "2026-08-13.3",
} as const;

export const HARNESS_MODEL = "openai/gpt-5.6-terra" as const;
export const HARNESS_PDF_MODEL = "openai/gpt-5.6-terra" as const;

export const AUDIT_EVALUATOR_MODELS = [
  HARNESS_MODEL,
  "openai/gpt-5.6-luna",
  "google/gemini-3.6-flash",
  "openai/gpt-5.6-sol",
] as const;

export type AuditEvaluatorModel = (typeof AUDIT_EVALUATOR_MODELS)[number];
export type AuditReasoningEffort = "high" | "max" | "xhigh";

const AUDIT_EVALUATOR_MODEL_SET = new Set<string>(AUDIT_EVALUATOR_MODELS);
const AUDIT_REASONING_EFFORT_SET = new Set<AuditReasoningEffort>([
  "high",
  "max",
  "xhigh",
]);

/**
 * Controlled switch used by model comparison runs. It intentionally ignores
 * the legacy OPENROUTER_MODEL variable so an old deployment value cannot
 * silently change the evaluator.
 */
export function resolveAuditEvaluatorModel(
  configured: string | undefined,
): AuditEvaluatorModel {
  const model = configured?.trim() || HARNESS_MODEL;
  if (!AUDIT_EVALUATOR_MODEL_SET.has(model)) {
    throw new Error(
      `OPENROUTER_AUDIT_MODEL must be one of: ${AUDIT_EVALUATOR_MODELS.join(", ")}.`,
    );
  }
  return model as AuditEvaluatorModel;
}

export function resolveAuditReasoningEffort(
  configured: string | undefined,
  fallback: AuditReasoningEffort = "high",
): AuditReasoningEffort {
  const effort = (configured?.trim() || fallback) as AuditReasoningEffort;
  if (!AUDIT_REASONING_EFFORT_SET.has(effort)) {
    throw new Error(
      "OPENROUTER_AUDIT_REASONING_EFFORT must be high, max or xhigh.",
    );
  }
  return effort;
}

/**
 * Terra is the current MVP evaluator. Treat stale Luna/Sol extraction
 * variables as legacy aliases so an old deployment value cannot silently
 * route new uploads away from the approved model.
 */
export function resolveHarnessModel(
  configured: string | undefined,
  fallback: string = HARNESS_MODEL,
) {
  const model = configured?.trim();
  if (
    !model ||
    model === "openai/gpt-5.6-luna" ||
    model === "openai/gpt-5.6-sol"
  ) {
    return fallback;
  }
  return model;
}

export function resolvePdfModel(configured: string | undefined) {
  return resolveHarnessModel(configured, HARNESS_PDF_MODEL);
}

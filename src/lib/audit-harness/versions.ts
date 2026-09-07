export const HARNESS_VERSIONS = {
  policy: "2026-09-06.1",
  prompt: "2026-09-07.1",
  schema: "2026-09-07.1",
  rules: "2026-09-06.1",
} as const;

export const HARNESS_MODEL = "openai/gpt-5.6-terra" as const;
export const HARNESS_PDF_MODEL = "openai/gpt-5.6-terra" as const;
export const HARNESS_FALLBACK_MODEL = "openai/gpt-5.6-sol" as const;
export const HARNESS_VERIFIER_MODEL = "openai/gpt-5.6-sol" as const;
export const FAST_EXTRACTION_MODEL = "google/gemini-3.1-flash-lite" as const;
export const FAST_EXTRACTION_REVIEW_MODEL = "google/gemini-3.7-flash" as const;

export type HarnessVerifierMode = "off" | "shadow" | "enforce";
export type ExtractionPipelineMode = "legacy" | "adaptive";

export const AUDIT_EVALUATOR_MODELS = [
  HARNESS_MODEL,
  "openai/gpt-5.6-luna",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.7-flash",
  "google/gemini-3.6-flash",
  "openai/gpt-5-nano",
  "qwen/qwen3.8-flash",
  "z-ai/glm-5.3-flash",
  "deepseek/deepseek-v4-flash-vision-exp",
  "openai/gpt-5.6-sol",
] as const;

export type AuditEvaluatorModel = (typeof AUDIT_EVALUATOR_MODELS)[number];

export const AUDIT_BENCHMARK_MODELS = [
  "google/gemini-3.1-flash-lite",
  "openai/gpt-5.6-luna",
  "google/gemini-3.7-flash",
  "openai/gpt-5-nano",
  "qwen/qwen3.8-flash",
  "z-ai/glm-5.3-flash",
  "deepseek/deepseek-v4-flash-vision-exp",
  HARNESS_MODEL,
] as const satisfies readonly AuditEvaluatorModel[];

export const AUDIT_BENCHMARK_MODEL_PROFILES: Record<
  (typeof AUDIT_BENCHMARK_MODELS)[number],
  {
    nativePdf: boolean;
    productionEligible: boolean;
    role: string;
    structuredOutput: "JSON_SCHEMA" | "JSON_ONLY";
  }
> = {
  "google/gemini-3.1-flash-lite": {
    nativePdf: true,
    productionEligible: true,
    role: "Candidato principal de extração multimodal econômica",
    structuredOutput: "JSON_SCHEMA",
  },
  "openai/gpt-5.6-luna": {
    nativePdf: true,
    productionEligible: true,
    role: "Candidato econômico de baixo risco de integração",
    structuredOutput: "JSON_SCHEMA",
  },
  "google/gemini-3.7-flash": {
    nativePdf: true,
    productionEligible: true,
    role: "Desafiante de qualidade multimodal",
    structuredOutput: "JSON_SCHEMA",
  },
  "openai/gpt-5-nano": {
    nativePdf: true,
    productionEligible: true,
    role: "Extração econômica sobre OCR preparado",
    structuredOutput: "JSON_SCHEMA",
  },
  "qwen/qwen3.8-flash": {
    nativePdf: false,
    productionEligible: true,
    role: "Extração multimodal após parser",
    structuredOutput: "JSON_SCHEMA",
  },
  "z-ai/glm-5.3-flash": {
    nativePdf: false,
    productionEligible: false,
    role: "Desafiante econômico sem garantia de JSON Schema",
    structuredOutput: "JSON_ONLY",
  },
  "deepseek/deepseek-v4-flash-vision-exp": {
    nativePdf: false,
    productionEligible: false,
    role: "Benchmark experimental apenas com corpus sanitizado",
    structuredOutput: "JSON_ONLY",
  },
  "openai/gpt-5.6-terra": {
    nativePdf: true,
    productionEligible: true,
    role: "Controle atual",
    structuredOutput: "JSON_SCHEMA",
  },
};
export type AuditReasoningEffort = "high" | "max" | "xhigh";

const AUDIT_EVALUATOR_MODEL_SET = new Set<string>(AUDIT_EVALUATOR_MODELS);
const EXTRACTION_RUNTIME_MODELS = new Set<string>([
  HARNESS_MODEL,
  HARNESS_FALLBACK_MODEL,
  FAST_EXTRACTION_MODEL,
  FAST_EXTRACTION_REVIEW_MODEL,
  "openai/gpt-5.6-luna",
  "openai/gpt-5-nano",
  "qwen/qwen3.8-flash",
]);
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

export function resolveExtractionPipelineMode(
  configured: string | undefined,
): ExtractionPipelineMode {
  const mode = configured?.trim() || "legacy";
  if (mode !== "legacy" && mode !== "adaptive") {
    throw new Error(
      "OPENROUTER_EXTRACTION_PIPELINE must be legacy or adaptive.",
    );
  }
  return mode;
}

/**
 * The adaptive path separates mechanical document reading from the expensive
 * audit. Production stays on the legacy pair unless the environment opts in.
 */
export function resolveExtractionModel(
  configured: string | undefined,
  mode: ExtractionPipelineMode,
  kind: "document" | "pdf" = "document",
) {
  const fallback =
    mode === "adaptive"
      ? FAST_EXTRACTION_MODEL
      : kind === "pdf"
        ? HARNESS_PDF_MODEL
        : HARNESS_MODEL;
  const model = configured?.trim() || fallback;
  if (!EXTRACTION_RUNTIME_MODELS.has(model)) {
    throw new Error(
      `OpenRouter extraction model is not approved: ${model}.`,
    );
  }
  return model;
}

export function resolveExtractionFallbackModel(
  configured: string | undefined,
  mode: ExtractionPipelineMode,
) {
  const fallback =
    mode === "adaptive"
      ? FAST_EXTRACTION_REVIEW_MODEL
      : HARNESS_FALLBACK_MODEL;
  const model = configured?.trim() || fallback;
  if (!EXTRACTION_RUNTIME_MODELS.has(model)) {
    throw new Error(
      `OpenRouter extraction fallback model is not approved: ${model}.`,
    );
  }
  return model;
}

/**
 * The recovery route is intentionally fixed to Sol. Accepting arbitrary or
 * same-model fallbacks would recreate the production failure where Terra was
 * retried with the same incompatible request.
 */
export function resolveHarnessFallbackModel(configured: string | undefined) {
  const model = configured?.trim() || HARNESS_FALLBACK_MODEL;
  if (model !== HARNESS_FALLBACK_MODEL) {
    throw new Error(
      `OpenRouter fallback model must be ${HARNESS_FALLBACK_MODEL}.`,
    );
  }
  return HARNESS_FALLBACK_MODEL;
}

export function resolveHarnessVerifierModel(configured: string | undefined) {
  const model = configured?.trim() || HARNESS_VERIFIER_MODEL;
  if (model !== HARNESS_VERIFIER_MODEL) {
    throw new Error(
      `OpenRouter verifier model must be ${HARNESS_VERIFIER_MODEL}.`,
    );
  }
  return HARNESS_VERIFIER_MODEL;
}

export function resolveHarnessVerifierReasoningEffort(
  configured: string | undefined,
) {
  const effort = configured?.trim() || "high";
  if (effort !== "high") {
    throw new Error(
      "OPENROUTER_VERIFIER_REASONING_EFFORT must be high in runtime.",
    );
  }
  return "high" as const;
}

export function resolveHarnessVerifierMode(
  configured: string | undefined,
  gateApproved: string | undefined = process.env.HARNESS_VERIFIER_GATE_APPROVED,
): HarnessVerifierMode {
  const mode = configured?.trim() || "off";
  if (mode !== "off" && mode !== "shadow" && mode !== "enforce") {
    throw new Error(
      "HARNESS_VERIFIER_MODE must be off, shadow or enforce.",
    );
  }
  if (mode === "enforce" && gateApproved !== "true") {
    throw new Error(
      "HARNESS_VERIFIER_MODE=enforce requires HARNESS_VERIFIER_GATE_APPROVED=true.",
    );
  }
  return mode;
}

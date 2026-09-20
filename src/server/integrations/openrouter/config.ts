import "server-only";
import { resolveExtractionReasoningEffort } from "@/lib/integrations/openrouter/extraction-reasoning";

import { AUDIT_POLICY } from "@/lib/audit-harness/policy";
import {
  resolveAuditEvaluatorModel,
  resolveAuditReasoningEffort,
  resolveExtractionFallbackModel,
  resolveExtractionModel,
  resolveExtractionPipelineMode,
  resolveHarnessVerifierModel,
  resolveHarnessVerifierReasoningEffort,
} from "@/lib/audit-harness/versions";

export type OpenRouterPdfEngine = "cloudflare-ai" | "mistral-ocr" | "native";
export type OpenRouterWorkload = "audit" | "extraction" | "verification";

const PDF_ENGINES = new Set<OpenRouterPdfEngine>([
  "cloudflare-ai",
  "mistral-ocr",
  "native",
]);

function requireApiKey(environment: NodeJS.ProcessEnv) {
  const value = environment.OPENROUTER_API_KEY ?? environment.OpenRouter_API_Key;

  if (!value || value.startsWith("replace-with")) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter.");
  }

  return value;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string) {
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function getOpenRouterConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workload: OpenRouterWorkload = "audit",
) {
  const schemaMode = environment.OPENROUTER_STRUCTURED_SCHEMA_MODE?.trim() || "bounded";
  if (schemaMode !== "bounded" && schemaMode !== "shape-only") throw new Error("OPENROUTER_STRUCTURED_SCHEMA_MODE must be bounded or shape-only.");
  const extractionPipelineMode = resolveExtractionPipelineMode(
    workload === "extraction"
      ? environment.OPENROUTER_EXTRACTION_PIPELINE
      : undefined,
  );
  const largePdfReader = workload === "extraction"
    ? environment.OPENROUTER_LARGE_PDF_READER?.trim() || "off" : "off";
  if (largePdfReader !== "off" && largePdfReader !== "gemini-3.7-low") {
    throw new Error("OPENROUTER_LARGE_PDF_READER must be off or gemini-3.7-low.");
  }
  if (largePdfReader !== "off" && extractionPipelineMode !== "adaptive") {
    throw new Error("OPENROUTER_LARGE_PDF_READER requires adaptive extraction.");
  }
  const configuredPdfEngine = workload === "verification"
    ? environment.OPENROUTER_VERIFIER_PDF_ENGINE ?? environment.OPENROUTER_PDF_ENGINE
    : environment.OPENROUTER_PDF_ENGINE;
  // The fixed verifier model supports native files. Do not silently prepend an
  // OCR pass (and its image cap/cost) when the caller did not request that engine.
  const pdfEngine = (configuredPdfEngine ||
    (extractionPipelineMode === "adaptive" || workload === "verification"
      ? "native"
      : "mistral-ocr")) as OpenRouterPdfEngine;
  const pdfFallbackEngine = (environment.OPENROUTER_PDF_FALLBACK_ENGINE ||
    pdfEngine) as OpenRouterPdfEngine;

  if (!PDF_ENGINES.has(pdfEngine) || !PDF_ENGINES.has(pdfFallbackEngine)) {
    throw new Error(
      "OPENROUTER_PDF_ENGINE, OPENROUTER_VERIFIER_PDF_ENGINE and OPENROUTER_PDF_FALLBACK_ENGINE must be cloudflare-ai, mistral-ocr or native.",
    );
  }

  const configuredMaxAttempts = parseInteger(
    environment.OPENROUTER_MAX_ATTEMPTS,
    3,
    1,
    5,
    "OPENROUTER_MAX_ATTEMPTS",
  );

  const maxTokens =
    workload === "extraction"
      ? parseInteger(
          environment.OPENROUTER_EXTRACTION_MAX_TOKENS,
          16_384,
          1_024,
          32_768,
          "OPENROUTER_EXTRACTION_MAX_TOKENS",
        )
      : workload === "verification"
        ? parseInteger(
            environment.OPENROUTER_VERIFIER_MAX_TOKENS,
            16_384,
            1_024,
            32_768,
            "OPENROUTER_VERIFIER_MAX_TOKENS",
          )
        : parseInteger(
            environment.OPENROUTER_AUDIT_MAX_TOKENS,
            8_192,
            1_024,
            16_384,
            "OPENROUTER_AUDIT_MAX_TOKENS",
          );

  return {
    largePdfReader,
    visualPdfWindows: workload === "extraction" && parseBoolean(environment.OPENROUTER_PDF_VISUAL_WINDOWS, false, "OPENROUTER_PDF_VISUAL_WINDOWS"),
    schemaMode,
    apiKey: requireApiKey(environment),
    appUrl: environment.NEXT_PUBLIC_APP_URL,
    // Audit and extraction use at most two calls. The second call is a bounded
    // recovery on Sol, never a same-model or unbounded provider loop.
    maxAttempts:
      workload === "verification" ? 1 : Math.min(2, configuredMaxAttempts),
    // OpenRouter pre-authorizes the maximum completion cost. A 32k ceiling made
    // otherwise valid uploads fail with HTTP 402 on low-balance keys before the
    // model read the document. Extraction needs more room than discovery because
    // a composite PDF may contain many independent receipts and payments.
    maxTokens,
    model:
      workload === "extraction"
        ? resolveExtractionModel(
            environment.OPENROUTER_EXTRACTION_MODEL,
            extractionPipelineMode,
          )
        : workload === "verification"
          ? resolveHarnessVerifierModel(environment.OPENROUTER_VERIFIER_MODEL)
          : resolveAuditEvaluatorModel(environment.OPENROUTER_AUDIT_MODEL),
    fallbackModel:
      workload === "audit"
        ? AUDIT_POLICY.fallbackModel
        : workload === "extraction"
          ? resolveExtractionFallbackModel(
              environment.OPENROUTER_EXTRACTION_FALLBACK_MODEL,
              extractionPipelineMode,
            )
          : undefined,
    fallbackReasoningEffort:
      workload === "audit" ? AUDIT_POLICY.fallbackReasoningEffort : undefined,
    extractionFallbackReasoningEffort:
      workload === "extraction"
        ? resolveExtractionReasoningEffort(environment.OPENROUTER_EXTRACTION_FALLBACK_REASONING_EFFORT, "high", "OPENROUTER_EXTRACTION_FALLBACK_REASONING_EFFORT")
        : undefined,
    pdfModel:
      workload === "extraction"
        ? resolveExtractionModel(
            environment.OPENROUTER_PDF_MODEL,
            extractionPipelineMode,
            "pdf",
          )
        : undefined,
    // The fallback is deliberately different from Terra. It is only consumed
    // by the bounded client recovery path after a configuration rejection,
    // eligible-endpoint absence, timeout or structurally invalid response.
    pdfFallbackModel:
      workload === "extraction"
        ? resolveExtractionFallbackModel(
            environment.OPENROUTER_PDF_FALLBACK_MODEL,
            extractionPipelineMode,
          )
        : undefined,
    pdfReasoningEffort:
      workload === "extraction"
        ? resolveExtractionReasoningEffort(environment.OPENROUTER_PDF_REASONING_EFFORT,
          extractionPipelineMode === "adaptive" ? "low" : "high", "OPENROUTER_PDF_REASONING_EFFORT")
        : undefined,
    reasoningEffort:
      workload === "extraction"
        ? resolveExtractionReasoningEffort(environment.OPENROUTER_EXTRACTION_REASONING_EFFORT,
          extractionPipelineMode === "adaptive" ? "low" : "high", "OPENROUTER_EXTRACTION_REASONING_EFFORT")
        : workload === "verification"
          ? resolveHarnessVerifierReasoningEffort(
              environment.OPENROUTER_VERIFIER_REASONING_EFFORT,
            )
          : resolveAuditReasoningEffort(
              environment.OPENROUTER_AUDIT_REASONING_EFFORT,
              AUDIT_POLICY.defaultReasoningEffort,
            ),
    pdfEngine,
    pdfFallbackEngine,
    extractionPipelineMode,
    extractionQualityGateEnabled:
      workload === "extraction" &&
      parseBoolean(
        environment.OPENROUTER_EXTRACTION_QUALITY_GATE,
        extractionPipelineMode === "adaptive",
        "OPENROUTER_EXTRACTION_QUALITY_GATE",
      ),
    // A second model shares the extraction deadline; it does not buy a fresh
    // full timeout. Legacy deployments keep their existing per-attempt budget.
    totalTimeoutMs: workload === "extraction" &&
      (extractionPipelineMode === "adaptive" || environment.OPENROUTER_EXTRACTION_TOTAL_TIMEOUT_MS)
      ? parseInteger(environment.OPENROUTER_EXTRACTION_TOTAL_TIMEOUT_MS, 90_000, 1_000, 240_000,
          "OPENROUTER_EXTRACTION_TOTAL_TIMEOUT_MS") : undefined,
    providerSort:
      workload === "extraction" && extractionPipelineMode === "adaptive"
        ? ("throughput" as const)
        : ("latency" as const),
    // Reading and background auditing have independent deadlines. A longer
    // audit must not delay upload acceptance or cancel a previously saved read.
    timeoutMs:
      workload === "verification"
        ? parseInteger(
            environment.OPENROUTER_VERIFIER_TIMEOUT_MS,
            120_000,
            1_000,
            600_000,
            "OPENROUTER_VERIFIER_TIMEOUT_MS",
          )
        : workload === "audit"
          ? parseInteger(environment.OPENROUTER_AUDIT_TIMEOUT_MS ?? environment.OPENROUTER_TIMEOUT_MS,
              120_000, 1_000, 180_000, "OPENROUTER_AUDIT_TIMEOUT_MS")
        : Math.min(
            parseInteger(
              workload === "extraction"
                ? environment.OPENROUTER_EXTRACTION_TIMEOUT_MS ??
                    environment.OPENROUTER_TIMEOUT_MS
                : environment.OPENROUTER_TIMEOUT_MS,
              workload === "extraction" &&
                extractionPipelineMode === "adaptive"
                ? 60_000
                : 120_000,
              1_000,
              120_000,
              workload === "extraction"
                ? "OPENROUTER_EXTRACTION_TIMEOUT_MS"
                : "OPENROUTER_TIMEOUT_MS",
            ),
            120_000,
          ),
    webSearchEnabled:
      workload === "audit" &&
      parseBoolean(
        environment.OPENROUTER_WEB_SEARCH_ENABLED,
        false,
        "OPENROUTER_WEB_SEARCH_ENABLED",
      ),
    webSearchMaxResults: parseInteger(
      environment.OPENROUTER_WEB_SEARCH_MAX_RESULTS,
      3,
      1,
      10,
      "OPENROUTER_WEB_SEARCH_MAX_RESULTS",
    ),
  } as const;
}

/** Explicit trial profile. Small/unknown PDFs, images and saved-window text
 * keep their original route. Physical page count comes from the upload parser,
 * not a model's completeness claim. No hidden recovery call follows this read. */
export function selectDocumentExtractionConfig(config: ReturnType<typeof getOpenRouterConfig>, document: {
  mimeType: string; pageCount?: number | null; visualWindows?: unknown;
}): ReturnType<typeof getOpenRouterConfig> {
  if (config.largePdfReader !== "gemini-3.7-low" || document.mimeType !== "application/pdf" || document.visualWindows ||
    !Number.isSafeInteger(document.pageCount) || (document.pageCount ?? 0) < 10) return config;
  return { ...config, pdfModel: "google/gemini-3.7-flash", pdfReasoningEffort: "low", pdfEngine: "native",
    maxAttempts: 1, maxTokens: 32768, timeoutMs: 120000, totalTimeoutMs: 120000, extractionQualityGateEnabled: true };
}

export function shouldReadVisualPdfWindows(config: ReturnType<typeof getOpenRouterConfig>, document: { mimeType: string; pageCount?: number | null }) {
  return config.visualPdfWindows && document.mimeType === "application/pdf" && Number.isSafeInteger(document.pageCount) &&
    (document.pageCount ?? 0) >= 5 && (document.pageCount ?? 0) <= 32;
}

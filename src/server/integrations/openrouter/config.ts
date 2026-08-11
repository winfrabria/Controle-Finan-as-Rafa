import "server-only";

import { AUDIT_POLICY } from "@/lib/audit-harness/policy";
import {
  HARNESS_MODEL,
  HARNESS_PDF_MODEL,
  resolveAuditEvaluatorModel,
  resolveAuditReasoningEffort,
  resolveHarnessModel,
  resolvePdfModel,
} from "@/lib/audit-harness/versions";

export type OpenRouterPdfEngine = "cloudflare-ai" | "mistral-ocr" | "native";
export type OpenRouterWorkload = "audit" | "extraction";

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
  const pdfEngine = (environment.OPENROUTER_PDF_ENGINE ||
    "mistral-ocr") as OpenRouterPdfEngine;

  if (!PDF_ENGINES.has(pdfEngine)) {
    throw new Error(
      "OPENROUTER_PDF_ENGINE must be cloudflare-ai, mistral-ocr or native.",
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
          8_192,
          1_024,
          32_768,
          "OPENROUTER_EXTRACTION_MAX_TOKENS",
        )
      : parseInteger(
          environment.OPENROUTER_AUDIT_MAX_TOKENS,
          8_192,
          1_024,
          16_384,
          "OPENROUTER_AUDIT_MAX_TOKENS",
        );

  return {
    apiKey: requireApiKey(environment),
    appUrl: environment.NEXT_PUBLIC_APP_URL,
    // Audit and extraction use at most two calls. The second call is a bounded
    // same-model recovery, never an unbounded provider loop.
    maxAttempts: workload === "audit" ? 2 : configuredMaxAttempts,
    // OpenRouter pre-authorizes the maximum completion cost. A 32k ceiling made
    // otherwise valid uploads fail with HTTP 402 on low-balance keys before the
    // model read the document. Both workloads remain configurable for unusually
    // large documents, while the default comfortably covers the current schema.
    maxTokens,
    model:
      workload === "extraction"
        ? resolveHarnessModel(
            environment.OPENROUTER_EXTRACTION_MODEL,
            HARNESS_MODEL,
          )
        : resolveAuditEvaluatorModel(environment.OPENROUTER_AUDIT_MODEL),
    fallbackModel:
      workload === "audit" ? AUDIT_POLICY.fallbackModel : undefined,
    fallbackReasoningEffort:
      workload === "audit" ? AUDIT_POLICY.fallbackReasoningEffort : undefined,
    pdfModel:
      workload === "extraction"
        ? resolvePdfModel(environment.OPENROUTER_PDF_MODEL)
        : undefined,
    // The approved PDF model is also the fallback, preventing stale model
    // comparison variables from changing the production route.
    pdfFallbackModel:
      workload === "extraction" ? HARNESS_PDF_MODEL : undefined,
    pdfReasoningEffort:
      workload === "extraction"
        ? environment.OPENROUTER_PDF_REASONING_EFFORT ?? "high"
        : undefined,
    reasoningEffort:
      workload === "extraction"
        ? environment.OPENROUTER_EXTRACTION_REASONING_EFFORT ?? "high"
        : resolveAuditReasoningEffort(
            environment.OPENROUTER_AUDIT_REASONING_EFFORT,
            AUDIT_POLICY.defaultReasoningEffort,
          ),
    pdfEngine,
    // PDFs longos e escaneados podem continuar transmitindo a resposta depois
    // de 60s. O limite de 120s acomoda extração e auditoria em high sem deixar
    // uma requisição isolada ocupar todo o orçamento da rota.
    timeoutMs: Math.min(
      parseInteger(
        environment.OPENROUTER_TIMEOUT_MS,
        120_000,
        1_000,
        120_000,
        "OPENROUTER_TIMEOUT_MS",
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

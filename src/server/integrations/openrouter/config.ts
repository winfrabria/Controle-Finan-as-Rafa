import "server-only";

import { AUDIT_POLICY } from "@/lib/audit-harness/policy";
import {
  HARNESS_MODEL,
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

export function getOpenRouterConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workload: OpenRouterWorkload = "audit",
) {
  const pdfEngine = (environment.OPENROUTER_PDF_ENGINE ||
    "cloudflare-ai") as OpenRouterPdfEngine;

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

  return {
    apiKey: requireApiKey(environment),
    appUrl: environment.NEXT_PUBLIC_APP_URL,
    // Audit uses at most two calls: Luna may repeat once for invalid structured
    // output; provider failures/timeouts switch the second call to Sol. The
    // configurable retry count remains exclusive to extraction.
    maxAttempts: workload === "audit" ? 2 : configuredMaxAttempts,
    model:
      workload === "extraction"
        ? resolveHarnessModel(
            environment.OPENROUTER_EXTRACTION_MODEL,
            HARNESS_MODEL,
          )
        : AUDIT_POLICY.model,
    fallbackModel:
      workload === "audit" ? AUDIT_POLICY.fallbackModel : undefined,
    fallbackReasoningEffort:
      workload === "audit" ? AUDIT_POLICY.fallbackReasoningEffort : undefined,
    pdfModel:
      workload === "extraction"
        ? resolvePdfModel(environment.OPENROUTER_PDF_MODEL)
        : undefined,
    pdfReasoningEffort:
      workload === "extraction"
        ? environment.OPENROUTER_PDF_REASONING_EFFORT ?? "high"
        : undefined,
    reasoningEffort:
      workload === "extraction"
        ? environment.OPENROUTER_EXTRACTION_REASONING_EFFORT ?? "max"
        : AUDIT_POLICY.defaultReasoningEffort,
    pdfEngine,
    // A request must fail fast enough for the public flow to surface a
    // recoverable error. Older Vercel environments used 120s; cap that stale
    // value at 60s instead of allowing several minutes of apparent silence.
    timeoutMs: Math.min(parseInteger(
      environment.OPENROUTER_TIMEOUT_MS,
      60_000,
      1_000,
      120_000,
      "OPENROUTER_TIMEOUT_MS",
    ), 60_000),
  } as const;
}

import "server-only";

import { HARNESS_MODEL } from "@/lib/audit-harness/versions";

export type OpenRouterPdfEngine = "cloudflare-ai" | "mistral-ocr" | "native";

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
) {
  const pdfEngine = (environment.OPENROUTER_PDF_ENGINE ||
    "cloudflare-ai") as OpenRouterPdfEngine;

  if (!PDF_ENGINES.has(pdfEngine)) {
    throw new Error(
      "OPENROUTER_PDF_ENGINE must be cloudflare-ai, mistral-ocr or native.",
    );
  }

  return {
    apiKey: requireApiKey(environment),
    appUrl: environment.NEXT_PUBLIC_APP_URL,
    maxAttempts: parseInteger(
      environment.OPENROUTER_MAX_ATTEMPTS,
      3,
      1,
      5,
      "OPENROUTER_MAX_ATTEMPTS",
    ),
    model: HARNESS_MODEL,
    pdfEngine,
    timeoutMs: parseInteger(
      environment.OPENROUTER_TIMEOUT_MS,
      60_000,
      1_000,
      120_000,
      "OPENROUTER_TIMEOUT_MS",
    ),
  } as const;
}

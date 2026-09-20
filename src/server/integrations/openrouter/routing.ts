export type OpenRouterOutputTokenParameter =
  | "max_tokens"
  | "max_completion_tokens";

export type OpenRouterOutputTokenLimit =
  | { max_completion_tokens: number; max_tokens?: never }
  | { max_completion_tokens?: never; max_tokens: number };

/**
 * OpenAI GPT-5 routes expose the completion budget as
 * `max_completion_tokens`. Sending `max_tokens` with `require_parameters` can
 * leave an otherwise eligible ZDR route with no matching endpoint.
 *
 * Other model families keep the OpenRouter-compatible `max_tokens` spelling
 * until their endpoint capabilities are explicitly known.
 */
export function getOpenRouterOutputTokenParameter(
  model: string,
): OpenRouterOutputTokenParameter {
  return /^openai\/gpt-5(?:$|[-.:/])/i.test(model.trim())
    ? "max_completion_tokens"
    : "max_tokens";
}

export function getOpenRouterOutputTokenLimit(
  model: string,
  limit: number,
  parameterOverride?: OpenRouterOutputTokenParameter,
): OpenRouterOutputTokenLimit {
  const parameter = parameterOverride ?? getOpenRouterOutputTokenParameter(model);
  return parameter === "max_completion_tokens"
    ? { max_completion_tokens: limit }
    : { max_tokens: limit };
}

/** Compatibility override for controlled verifier probes. Keep the documented
 * completion-token spelling by default; endpoint catalogs may advertise the
 * legacy spelling differently when require_parameters is enabled. */
export function resolveVerificationOutputTokenParameter(value?: string): OpenRouterOutputTokenParameter {
  const parameter = value?.trim() || "max_completion_tokens";
  if (parameter !== "max_tokens" && parameter !== "max_completion_tokens") {
    throw new Error("HARNESS_PROBE_TOKEN_PARAMETER must be max_tokens or max_completion_tokens.");
  }
  return parameter;
}

export type OpenRouterProviderSort = "latency" | "price" | "throughput";

export function getOpenRouterProviderRouting(
  sort: OpenRouterProviderSort = "latency",
) {
  return {
    require_parameters: true,
    sort,
    zdr: true,
  };
}

const ENDPOINT_UNAVAILABLE_CODES = new Set([
  "ENDPOINT_NOT_FOUND",
  "MODEL_NOT_FOUND",
  "NO_ELIGIBLE_ENDPOINT",
  "NO_ELIGIBLE_ENDPOINTS",
  "NO_ENDPOINT",
  "NO_ENDPOINTS",
  "NO_ENDPOINTS_FOUND",
  "PROVIDER_NOT_FOUND",
  "ROUTE_NOT_FOUND",
]);

const ENDPOINT_UNAVAILABLE_MESSAGE =
  /(?:\b(?:no|without|unable to find|could not find|not found|unavailable|unsupported)\b[\s\S]{0,100}\b(?:endpoint|endpoints|provider|providers|route|routes|deployment|model)\b|\b(?:endpoint|endpoints|provider|providers|route|routes|deployment|model)\b[\s\S]{0,100}\b(?:not found|not available|not supported|unavailable|does not exist|do not exist|does not support|doesn't support|cannot support|unsupported|no eligible)\b)/i;

const NON_RETRYABLE_PROVIDER_STATUS_CODES = new Set([402, 429, 503]);

function normalizeProviderCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).trim().toUpperCase();
  return normalized ? normalized.slice(0, 80) : undefined;
}

export function getOpenRouterProviderStatusCode(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 100 && value <= 599
      ? value
      : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = /^\s*(?:http[-_\s]*)?([1-5]\d{2})\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

export function isOpenRouterNonRetryableStatusCode(status: number) {
  return NON_RETRYABLE_PROVIDER_STATUS_CODES.has(status);
}

/**
 * A 404 is retryable only when OpenRouter says that model routing has no
 * eligible endpoint. Generic missing-resource 404s must not trigger a paid
 * retry on a second model.
 */
export function isOpenRouterEndpointUnavailable404(input: {
  message?: unknown;
  providerCode?: unknown;
  status?: number;
}) {
  if (input.status !== 404) return false;

  const providerCode = normalizeProviderCode(input.providerCode);
  if (providerCode && ENDPOINT_UNAVAILABLE_CODES.has(providerCode)) {
    return true;
  }

  return (
    typeof input.message === "string" &&
    ENDPOINT_UNAVAILABLE_MESSAGE.test(input.message)
  );
}

export function getOpenRouterProviderDiagnostic(input: {
  message?: string;
  providerCode?: unknown;
  status: number;
}) {
  return isOpenRouterEndpointUnavailable404(input)
    ? ("provider-endpoint-unavailable" as const)
    : "provider-request-failed" as const;
}

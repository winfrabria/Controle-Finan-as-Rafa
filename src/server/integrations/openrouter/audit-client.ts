import "server-only";

import { z } from "zod";

import {
  AI_DISCOVERY_JSON_SCHEMA,
  AUDIT_DISCOVERY_PROMPT,
  aiDiscoveryResponseSchema,
  type AiDiscoveryResponse,
  type ContextAnswerForAudit,
  type HarnessFinding,
  type HarnessInvoice,
  type WorkRuleInput,
} from "@/lib/audit-harness";
import { getOpenRouterConfig } from "./config";
import { OpenRouterClientError } from "./client";

const OPENROUTER_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const ROUTING_METADATA_KEYS = [
  "model",
  "provider",
  "provider_name",
  "request_id",
  "route",
  "upstream_id",
  "upstream_status",
] as const;

const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
      annotations: z.array(z.object({
        type: z.string(),
        url_citation: z.object({
          title: z.string().optional(),
          url: z.string().url(),
        }).passthrough().optional(),
      }).passthrough()).optional(),
    }).passthrough(),
  })).min(1),
  model: z.string(),
  provider: z.string().optional(),
  usage: z.object({
    completion_tokens: z.number().optional(),
    prompt_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cost: z.number().nonnegative().optional(),
    server_tool_use: z.object({
      web_search_requests: z.number().int().nonnegative().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const POLICY_QUESTION_PATTERN =
  /\b(?:quais?|qual)\s+(?:regras?|pol[ií]ticas?|crit[eé]rios?|par[aâ]metros?|limites?)\b|\b(?:defina|estabele[çc]a|informe)\s+(?:as?\s+)?(?:regras?|pol[ií]ticas?|crit[eé]rios?|par[aâ]metros?|limites?)\b|\b(?:what|which)\s+(?:rules?|polic(?:y|ies)|criteria|parameters?|limits?)\b|\b(?:define|establish|provide|set)\s+(?:the\s+)?(?:rules?|polic(?:y|ies)|criteria|parameters?|limits?)\b/i;
const OPAQUE_OPTION_PATTERN = /^(?:all|any|unknown|undefined|null)\b/i;

function usableSelectOptions(options: unknown) {
  if (!Array.isArray(options)) return [];
  const seenLabels = new Set<string>();
  const seenValues = new Set<string>();
  return options.flatMap((option) => {
    if (!isRecord(option)) return [];
    const label = typeof option.label === "string" ? option.label.trim() : "";
    const value = typeof option.value === "string" ? option.value.trim() : "";
    if (
      !label ||
      !value ||
      label.length > 160 ||
      value.length > 80 ||
      OPAQUE_OPTION_PATTERN.test(label) ||
      OPAQUE_OPTION_PATTERN.test(value) ||
      seenLabels.has(label.toLocaleLowerCase("pt-BR")) ||
      seenValues.has(value.toLocaleLowerCase("pt-BR"))
    ) {
      return [];
    }
    seenLabels.add(label.toLocaleLowerCase("pt-BR"));
    seenValues.add(value.toLocaleLowerCase("pt-BR"));
    return [{ label, value }];
  });
}

export function normalizeAuditContent(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.contextQuestions)) return value;

  // Preserve o sinal de contexto declarado pelo provedor quando não houver
  // pergunta utilizável; o engine converte esse caso em
  // INFORMATION_INSUFFICIENT, sem fabricar perguntas públicas.
  const declaredNeedsContext =
    value.needsContext === true && value.contextQuestions.length === 0;

  const contextQuestions = value.contextQuestions.flatMap((question) => {
    if (!isRecord(question)) return [];
    const prompt = typeof question.prompt === "string" ? question.prompt.trim() : "";
    const type = question.type;
    if (!prompt || POLICY_QUESTION_PATTERN.test(prompt)) return [];

    if (type !== "SINGLE_SELECT") {
      return [{ ...question, prompt, options: [] }];
    }

    const options = usableSelectOptions(question.options);
    if (options.length < 2) {
      return [{ ...question, prompt, type: "TEXT", options: [] }];
    }
    return [{ ...question, prompt, options }];
  });

  return {
    ...value,
    contextQuestions,
    needsContext: declaredNeedsContext || contextQuestions.length > 0,
  };
}

function webSourcesFrom(
  annotations:
    | Array<{ type: string; url_citation?: { title?: string; url: string } }>
    | undefined,
) {
  const seen = new Set<string>();
  return (annotations ?? [])
    .flatMap((annotation) =>
      annotation.url_citation ? [annotation.url_citation] : [],
    )
    .filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    });
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 5_000);
  }

  const dateDelay = Date.parse(value) - Date.now();
  return Number.isFinite(dateDelay)
    ? Math.min(Math.max(dateDelay, 0), 5_000)
    : undefined;
}

function providerErrorKind(status: number) {
  return status === 408 || status === 504 ? "timeout" : "provider";
}

function providerErrorMessage(status: number) {
  if (providerErrorKind(status) === "timeout") {
    return `OpenRouter audit request exceeded the provider time limit (HTTP ${status}).`;
  }

  return `OpenRouter audit provider rejected the request (HTTP ${status}).`;
}

function safeRoutingMetadata(value: unknown) {
  if (!isRecord(value)) return undefined;
  const entries = ROUTING_METADATA_KEYS.flatMap((key) => {
    const entry = value[key];
    return typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
      ? [[key, typeof entry === "string" ? entry.slice(0, 160) : entry] as const]
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function safeProviderErrorDetails(response: Response) {
  const requestId =
    response.headers.get("x-openrouter-request-id") ??
    response.headers.get("x-request-id") ??
    undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; metadata?: Record<string, unknown> };
      metadata?: Record<string, unknown>;
      provider?: unknown;
    };
    const metadata = body.error?.metadata ?? body.metadata;
    const routingMetadata = safeRoutingMetadata(metadata);
    const provider =
      typeof body.provider === "string"
        ? body.provider.slice(0, 160)
        : typeof metadata?.provider_name === "string"
          ? metadata.provider_name.slice(0, 160)
          : undefined;
    return {
      diagnosticDetails: {
        ...(body.error?.code !== undefined
          ? { providerCode: String(body.error.code).slice(0, 80) }
          : {}),
        ...(typeof metadata?.route === "string"
          ? { route: metadata.route.slice(0, 160) }
          : {}),
      },
      provider,
      requestId:
        requestId ??
        (typeof metadata?.request_id === "string"
          ? metadata.request_id.slice(0, 160)
          : undefined),
      routingMetadata,
    };
  } catch {
    return { requestId };
  }
}

export type AuditDiscoveryRequest = {
  contextAnswers?: ContextAnswerForAudit[];
  invoice: HarnessInvoice;
  deterministicFindings: HarnessFinding[];
  workRules: WorkRuleInput[];
  reasoningEffort: "high" | "max" | "xhigh";
};

export type AuditDiscoveryResult = {
  attempts: number;
  attemptTrace: AuditDiscoveryAttempt[];
  data: AiDiscoveryResponse;
  latencyMs: number;
  model: string;
  provider?: string;
  requestId?: string;
  routingMetadata?: Record<string, string | number | boolean | null>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    webSearchRequests?: number;
  };
  webSources?: Array<{ title?: string; url: string }>;
};

export interface AuditDiscoveryClient {
  discover(request: AuditDiscoveryRequest): Promise<AuditDiscoveryResult>;
}

type Options = Omit<
  ReturnType<typeof getOpenRouterConfig>,
  | "fallbackModel"
  | "fallbackReasoningEffort"
  | "pdfModel"
  | "pdfFallbackModel"
  | "pdfReasoningEffort"
  | "reasoningEffort"
  | "maxTokens"
  | "webSearchEnabled"
  | "webSearchMaxResults"
> & {
  fallbackModel?: string;
  fallbackReasoningEffort?: AuditDiscoveryRequest["reasoningEffort"];
  pdfModel?: string;
  pdfReasoningEffort?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  webSearchEnabled?: boolean;
  webSearchMaxResults?: number;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type AuditDiscoveryAttempt = {
  attempt: number;
  detail?:
    | "invalid-audit-envelope"
    | "invalid-audit-json"
    | "invalid-audit-schema"
    | "provider-configuration-rejected"
    | "provider-error"
    | "request-timeout";
  kind: "invalid-response" | "provider" | "success" | "timeout";
  latencyMs: number;
  model: string;
  provider?: string;
  requestId?: string;
  routingMetadata?: Record<string, string | number | boolean | null>;
  status?: number;
  validationIssues?: string[];
};

function safeAttemptDiagnostics(error: OpenRouterClientError) {
  const detail =
    error.kind === "timeout"
      ? ("request-timeout" as const)
      : error.diagnostic === "provider-configuration-rejected"
        ? ("provider-configuration-rejected" as const)
      : error.kind === "provider"
        ? ("provider-error" as const)
        : error.message.includes("envelope")
          ? ("invalid-audit-envelope" as const)
          : error.message.includes("non-JSON")
            ? ("invalid-audit-json" as const)
            : ("invalid-audit-schema" as const);
  const validationIssues =
    error.cause instanceof z.ZodError
      ? error.cause.issues.slice(0, 12).map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root";
          return `${path}:${issue.code}`;
        })
      : undefined;

  return {
    detail,
    provider: error.provider,
    requestId: error.requestId,
    routingMetadata: error.routingMetadata,
    ...(validationIssues && validationIssues.length > 0
      ? { validationIssues }
      : {}),
  };
}

export class OpenRouterAuditDiscoveryError extends OpenRouterClientError {
  constructor(
    error: OpenRouterClientError,
    public readonly model: string,
    public readonly attempts: number,
    public readonly attemptTrace: AuditDiscoveryAttempt[],
  ) {
    super(
      error.kind,
      error.message,
      error.retryable,
      error.status,
      error.retryAfterMs,
      {
        cause: error,
        diagnostic: error.diagnostic,
        diagnosticDetails: error.diagnosticDetails,
        provider: error.provider,
        requestId: error.requestId,
        routingMetadata: error.routingMetadata,
      },
    );
    this.name = "OpenRouterAuditDiscoveryError";
  }
}

export class OpenRouterAuditDiscoveryClient implements AuditDiscoveryClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: Options) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async discover(request: AuditDiscoveryRequest): Promise<AuditDiscoveryResult> {
    const startedAt = Date.now();
    const attemptTrace: AuditDiscoveryAttempt[] = [];
    let route = {
      model: this.options.model,
      reasoningEffort: request.reasoningEffort,
    };

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const result = await this.performRequest(
          request,
          route.model,
          route.reasoningEffort,
        );
        attemptTrace.push({
          attempt,
          kind: "success",
          latencyMs: Date.now() - attemptStartedAt,
          model: route.model,
          provider: result.provider,
          requestId: result.requestId,
          routingMetadata: result.routingMetadata,
        });
        return {
          ...result,
          attempts: attempt,
          attemptTrace,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        const normalized = this.normalizeError(error);
        attemptTrace.push({
          attempt,
          ...safeAttemptDiagnostics(normalized),
          kind: normalized.kind,
          latencyMs: Date.now() - attemptStartedAt,
          model: route.model,
          status: normalized.status,
        });
        const hasAnotherAttempt = attempt < this.options.maxAttempts;
        const hasDistinctFallback = Boolean(
          this.options.fallbackModel &&
            this.options.fallbackModel !== this.options.model,
        );
        const canRetry =
          hasDistinctFallback &&
          (normalized.kind === "timeout" ||
            normalized.kind === "invalid-response" ||
            (normalized.kind === "provider" && normalized.status === 400));

        if (!hasAnotherAttempt || !canRetry) {
          throw new OpenRouterAuditDiscoveryError(
            normalized,
            route.model,
            attempt,
            attemptTrace,
          );
        }

        await this.sleep(
          normalized.retryAfterMs ??
            Math.min(500 * 2 ** (attempt - 1), 5_000),
        );

        route = {
          model: this.options.fallbackModel!,
          reasoningEffort: this.options.fallbackReasoningEffort ?? "high",
        };
      }
    }

    throw new OpenRouterAuditDiscoveryError(
      new OpenRouterClientError(
        "provider",
        "OpenRouter audit has no configured model.",
        false,
      ),
      this.options.model,
      0,
      attemptTrace,
    );
  }

  private async performRequest(
    request: AuditDiscoveryRequest,
    model: string,
    reasoningEffort: AuditDiscoveryRequest["reasoningEffort"],
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImplementation(OPENROUTER_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Metadata": "enabled",
          "X-Title": "WinfraBR Audit Harness",
          ...(this.options.appUrl ? { "HTTP-Referer": this.options.appUrl } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: AUDIT_DISCOVERY_PROMPT.system },
            {
              role: "user",
              content: `${AUDIT_DISCOVERY_PROMPT.user}\n\n${JSON.stringify({
                contextAnswers: request.contextAnswers ?? [],
                invoice: request.invoice,
                deterministicFindings: request.deterministicFindings,
                workRules: request.workRules,
              })}`,
            },
          ],
          reasoning: { effort: reasoningEffort, exclude: true },
          response_format: {
            type: "json_schema",
            json_schema: { name: "audit_discovery", strict: true, schema: AI_DISCOVERY_JSON_SCHEMA },
          },
          max_tokens: this.options.maxTokens ?? 8_192,
          stream: false,
          ...(this.options.webSearchEnabled
            ? {
                max_tool_calls: 1,
                tools: [{
                  type: "openrouter:web_search",
                  parameters: {
                    engine: "auto",
                    max_results: this.options.webSearchMaxResults ?? 3,
                    max_total_results: this.options.webSearchMaxResults ?? 3,
                    max_uses: 1,
                    search_context_size: "low",
                  },
                }],
              }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const providerDetails = await safeProviderErrorDetails(response);
        throw new OpenRouterClientError(
          providerErrorKind(response.status),
          providerErrorMessage(response.status),
          RETRYABLE_STATUS_CODES.has(response.status),
          response.status,
          parseRetryAfter(response.headers.get("retry-after")),
          {
            diagnostic:
              response.status === 400
                ? "provider-configuration-rejected"
                : "provider-request-failed",
            diagnosticDetails: providerDetails.diagnosticDetails,
            provider: providerDetails.provider,
            requestId: providerDetails.requestId,
            routingMetadata: providerDetails.routingMetadata,
          },
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw new OpenRouterClientError(
            "timeout",
            "OpenRouter audit timed out while receiving the response.",
            true,
            undefined,
            undefined,
            { cause: error },
          );
        }
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned a non-JSON envelope.", true, undefined, undefined, { cause: error });
      }
      const envelope = responseSchema.safeParse(body);
      if (!envelope.success) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned an invalid audit envelope.", true, undefined, undefined, { cause: envelope.error });
      }

      let content: unknown;
      try {
        content = normalizeAuditContent(
          JSON.parse(envelope.data.choices[0].message.content),
        );
      } catch (error) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned non-JSON audit content.", true, undefined, undefined, { cause: error });
      }
      const parsed = aiDiscoveryResponseSchema.safeParse(content);
      if (!parsed.success) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter audit output violated the schema.", true, undefined, undefined, { cause: parsed.error });
      }

      const usage = envelope.data.usage;
      const requestId =
        response.headers.get("x-openrouter-request-id") ??
        response.headers.get("x-request-id") ??
        undefined;
      const routingMetadata = safeRoutingMetadata(
        isRecord(body) ? body.metadata : undefined,
      );
      const webSources = webSourcesFrom(
        envelope.data.choices[0].message.annotations,
      );
      return {
        data: parsed.data,
        model: envelope.data.model,
        provider: envelope.data.provider,
        requestId,
        routingMetadata,
        ...(webSources.length > 0 ? { webSources } : {}),
        ...(usage ? { usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          costUsd: usage.cost,
          webSearchRequests: usage.server_tool_use?.web_search_requests,
        } } : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeError(error: unknown) {
    if (error instanceof OpenRouterClientError) return error;
    if (error instanceof Error && error.name === "AbortError") {
      return new OpenRouterClientError("timeout", "OpenRouter audit timed out.", true, undefined, undefined, { cause: error });
    }
    return new OpenRouterClientError("provider", "OpenRouter audit request failed.", true, undefined, undefined, { cause: error });
  }
}

let defaultAuditClient: OpenRouterAuditDiscoveryClient | undefined;

export function getOpenRouterAuditDiscoveryClient() {
  defaultAuditClient ??= new OpenRouterAuditDiscoveryClient(getOpenRouterConfig());
  return defaultAuditClient;
}

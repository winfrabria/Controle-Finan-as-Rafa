import "server-only";
import { buildSourceComparisons } from "@/lib/audit-harness/source-comparisons";
import { buildDateReviewSources } from "@/lib/audit-harness/date-review";
import { providerVerificationSchema } from "@/lib/audit-harness/provider-verification-schema";

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
import {
  getOpenRouterProviderStatusCode,
  getOpenRouterOutputTokenLimit,
  getOpenRouterProviderDiagnostic,
  getOpenRouterProviderRouting,
  isOpenRouterNonRetryableStatusCode,
} from "./routing";

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

const providerErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.union([z.string(), z.number()]).optional(),
      message: z.string().optional(),
      metadata: z.unknown().optional(),
    }).passthrough(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const POLICY_QUESTION_PATTERN =
  /\b(?:quais?|qual)\s+(?:regras?|pol[ií]ticas?|crit[eé]rios?|par[aâ]metros?|limites?)\b|\b(?:defina|estabele[çc]a|informe)\s+(?:as?\s+)?(?:regras?|pol[ií]ticas?|crit[eé]rios?|par[aâ]metros?|limites?)\b|\b(?:what|which)\s+(?:rules?|polic(?:y|ies)|criteria|parameters?|limits?)\b|\b(?:define|establish|provide|set)\s+(?:the\s+)?(?:rules?|polic(?:y|ies)|criteria|parameters?|limits?)\b/i;
const SENSITIVE_QUESTION_PATTERN =
  /\b(?:senha|password|passcode|pin|otp|2fa|mfa|token|segredo|secret|credencia(?:l|is)|credentials?|chave\s+(?:de\s+)?api|api\s*key|c[oó]digo\s+(?:de\s+)?(?:autentica[çc][aã]o|verifica[çc][aã]o|acesso)|authentication\s+code|verification\s+code|n[uú]mero\s+(?:do\s+)?cart[aã]o|card\s+number|cvv|cvc|conta\s+banc[aá]ria|bank\s+account|ag[eê]ncia\s+banc[aá]ria|chave\s+pix|pix\s+key|cpf)\b/i;
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
    const questionText = [
      prompt,
      typeof question.rationale === "string" ? question.rationale : "",
      ...(Array.isArray(question.options)
        ? question.options.flatMap((option) =>
            isRecord(option)
              ? [
                  typeof option.label === "string" ? option.label : "",
                  typeof option.value === "string" ? option.value : "",
                ]
              : [],
          )
        : []),
    ].join(" ");
    if (
      !prompt ||
      POLICY_QUESTION_PATTERN.test(prompt) ||
      SENSITIVE_QUESTION_PATTERN.test(questionText)
    ) return [];

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
      error?: {
        code?: unknown;
        message?: unknown;
        metadata?: Record<string, unknown>;
      };
      metadata?: Record<string, unknown>;
      openrouter_metadata?: Record<string, unknown>;
      provider?: unknown;
    };
    const metadata =
      body.error?.metadata ?? body.openrouter_metadata ?? body.metadata;
    const providerCode =
      body.error?.code !== undefined
        ? String(body.error.code).slice(0, 80)
        : undefined;
    const routingMetadata = safeRoutingMetadata(metadata);
    const provider =
      typeof body.provider === "string"
        ? body.provider.slice(0, 160)
        : typeof metadata?.provider_name === "string"
          ? metadata.provider_name.slice(0, 160)
          : undefined;
    return {
      diagnosticDetails: {
        ...(providerCode ? { providerCode } : {}),
        ...(typeof metadata?.route === "string"
          ? { route: metadata.route.slice(0, 160) }
          : {}),
      },
      message:
        typeof body.error?.message === "string"
          ? body.error.message.slice(0, 300)
          : undefined,
      providerCode,
      provider,
      requestId:
        requestId ??
        (typeof metadata?.request_id === "string"
          ? metadata.request_id.slice(0, 160)
          : undefined),
      routingMetadata,
    };
  } catch {
    return { message: undefined, providerCode: undefined, requestId };
  }
}

export type AuditDiscoveryRequest = {
  contextAnswers?: ContextAnswerForAudit[];
  extractionLimitations?: Array<{ page: number; kind: "OTHER"; expectedSources: number; extractedSources: number }>;
  extractionLimitationSummary?: string;
  invoice: HarnessInvoice;
  deterministicFindings: HarnessFinding[];
  workRules: WorkRuleInput[];
  reasoningEffort: "low" | "medium" | "high" | "max" | "xhigh";
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
  | "extractionFallbackReasoningEffort"
  | "pdfModel"
  | "pdfFallbackModel"
  | "pdfFallbackEngine"
  | "pdfReasoningEffort"
  | "extractionPipelineMode"
  | "largePdfReader"
  | "visualPdfWindows"
  | "extractionQualityGateEnabled"
  | "totalTimeoutMs"
  | "providerSort"
  | "reasoningEffort"
  | "maxTokens"
  | "schemaMode"
  | "webSearchEnabled"
  | "webSearchMaxResults"
> & {
  fallbackModel?: string;
  fallbackReasoningEffort?: AuditDiscoveryRequest["reasoningEffort"];
  pdfModel?: string;
  pdfReasoningEffort?: string;
  reasoningEffort?: string;
  /** Isolated model trials only; runtime keeps request-owned effort. */
  experimentalReasoningEffort?: "low" | "medium";
  schemaMode?: "bounded" | "shape-only";
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
    | "provider-endpoint-unavailable"
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
  generationId?: string;
  usage?: AuditDiscoveryResult["usage"];
};

function safeAttemptDiagnostics(error: OpenRouterClientError) {
  const detail =
    error.kind === "timeout"
      ? ("request-timeout" as const)
      : error.diagnostic === "provider-configuration-rejected"
        ? ("provider-configuration-rejected" as const)
        : error.diagnostic === "provider-endpoint-unavailable"
          ? ("provider-endpoint-unavailable" as const)
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
    ...(error.generationId ? { generationId: error.generationId } : {}),
    ...(error.usage ? { usage: error.usage } : {}),
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
        generationId: error.generationId,
        usage: error.usage,
        latencyMs: attemptTrace.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
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
    const callBudget = Math.min(2, Math.max(1, this.options.maxAttempts));
    let route: { model: string; reasoningEffort: AuditDiscoveryRequest["reasoningEffort"] | "low" | "medium" } = {
      model: this.options.model,
      reasoningEffort: this.options.experimentalReasoningEffort ?? request.reasoningEffort,
    };

    for (let attempt = 1; attempt <= callBudget; attempt += 1) {
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
        const hasAnotherAttempt = attempt < callBudget;
        const hasDistinctFallback = Boolean(
          this.options.fallbackModel &&
            this.options.fallbackModel !== this.options.model,
        );
        const isConfigurationRejection =
          normalized.kind === "provider" &&
          normalized.diagnostic === "provider-configuration-rejected";
        const isEndpointUnavailable =
          normalized.kind === "provider" &&
          normalized.diagnostic === "provider-endpoint-unavailable";
        // Some providers occasionally return an HTTP 200 response with an
        // unusable body and explicit zero-token/zero-cost usage. That request
        // was not processed, so retry the same route once before paying for a
        // materially more expensive fallback. Missing usage is not evidence
        // of zero cost and keeps the existing fallback behavior.
        const isZeroCostInvalidResponse =
          normalized.kind === "invalid-response" &&
          normalized.usage?.promptTokens === 0 &&
          normalized.usage.completionTokens === 0 &&
          normalized.usage.totalTokens === 0 &&
          normalized.usage.costUsd === 0;
        const canRetry =
          isZeroCostInvalidResponse ||
          (hasDistinctFallback &&
            (normalized.kind === "timeout" ||
              normalized.kind === "invalid-response" ||
              isConfigurationRejection ||
              isEndpointUnavailable));

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

        if (!isZeroCostInvalidResponse) {
          route = {
            model: this.options.fallbackModel!,
            reasoningEffort: this.options.fallbackReasoningEffort ?? "high",
          };
        }
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
    reasoningEffort: AuditDiscoveryRequest["reasoningEffort"] | "low" | "medium",
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
              content: `${AUDIT_DISCOVERY_PROMPT.user}\n${request.extractionLimitationSummary || request.extractionLimitations?.length ? "A leitura é parcial. Analise as evidências rastreáveis disponíveis, mesmo havendo outras páginas ou campos incompletos. Não preencha lacunas por suposição, não conclua ausência de documento pela falha de extração, nem declare cobertura integral. Compare fontes vinculadas considerando total versus componentes, descontos explícitos e datas com funções distintas. Uma falha de leitura não é pergunta ao usuário. Os apontamentos são hipóteses para conferência no original." : ""}\n\n${JSON.stringify({
                contextAnswers: request.contextAnswers ?? [],
                invoice: request.invoice,
                deterministicFindings: request.deterministicFindings,
                workRules: request.workRules,
                extractionLimitations: request.extractionLimitations ?? [],
                extractionLimitationSummary: request.extractionLimitationSummary ?? null,
                  sourceComparisons: buildSourceComparisons(request.invoice),
                  dateReviewSources: buildDateReviewSources(request.invoice),
              })}`,
            },
          ],
          reasoning: { effort: reasoningEffort, exclude: true },
          response_format: {
            type: "json_schema",
            json_schema: { name: "audit_discovery", strict: true, schema: this.options.schemaMode === "shape-only"
              ? providerVerificationSchema(AI_DISCOVERY_JSON_SCHEMA) : AI_DISCOVERY_JSON_SCHEMA },
          },
          provider: getOpenRouterProviderRouting(),
          ...getOpenRouterOutputTokenLimit(model, this.options.maxTokens ?? 8_192),
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
                : getOpenRouterProviderDiagnostic({
                    message: providerDetails.message,
                    providerCode: providerDetails.providerCode,
                    status: response.status,
                  }),
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
      // Billing metadata survives a null/truncated/invalid content response.
      // Never retain the model's hidden reasoning or raw response body.
      const record = isRecord(body) ? body : {};
      const usageResult = responseSchema.shape.usage.safeParse(record.usage);
      const usageMetadata = usageResult.success ? usageResult.data : undefined;
      const responseMetadata = {
        generationId: typeof record.id === "string" ? record.id.slice(0, 200) : undefined,
        provider: typeof record.provider === "string" ? record.provider.slice(0, 160) : undefined,
        requestId: response.headers.get("x-openrouter-request-id") ?? response.headers.get("x-request-id") ?? undefined,
        ...(usageMetadata ? { usage: { promptTokens: usageMetadata.prompt_tokens, completionTokens: usageMetadata.completion_tokens,
          totalTokens: usageMetadata.total_tokens, costUsd: usageMetadata.cost } } : {}),
      };
      if (!envelope.success) {
        const providerError = providerErrorEnvelopeSchema.safeParse(body);
        if (providerError.success) {
          const providerCode =
            providerError.data.error.code !== undefined
              ? String(providerError.data.error.code).slice(0, 80)
              : undefined;
          const explicitStatus = getOpenRouterProviderStatusCode(providerCode);
          const responseRecord = isRecord(body) ? body : undefined;
          const providerMetadata =
            providerError.data.error.metadata ??
            responseRecord?.openrouter_metadata ??
            responseRecord?.metadata;
          const routingMetadata = safeRoutingMetadata(providerMetadata);
          const provider =
            typeof responseRecord?.provider === "string"
              ? responseRecord.provider.slice(0, 160)
              : typeof routingMetadata?.provider_name === "string"
                ? routingMetadata.provider_name
                : undefined;
          const diagnostic =
            explicitStatus === 400
              ? "provider-configuration-rejected"
              : explicitStatus !== undefined
                ? getOpenRouterProviderDiagnostic({
                    message: providerError.data.error.message,
                    providerCode,
                    status: explicitStatus,
                  })
                : "provider-error-envelope";
          const errorOptions = {
            cause: envelope.error,
            diagnostic,
            diagnosticDetails: {
              ...(providerCode ? { providerCode } : {}),
              ...(routingMetadata ? { routing: routingMetadata } : {}),
            },
            provider,
            requestId:
              response.headers.get("x-openrouter-request-id") ??
              response.headers.get("x-request-id") ??
              (typeof routingMetadata?.request_id === "string"
                ? routingMetadata.request_id
                : undefined),
            routingMetadata,
          };

          if (
            explicitStatus !== undefined &&
            isOpenRouterNonRetryableStatusCode(explicitStatus)
          ) {
            throw new OpenRouterClientError(
              "provider",
              "OpenRouter audit provider rejected the request.",
              false,
              explicitStatus,
              undefined,
              errorOptions,
            );
          }
          if (diagnostic === "provider-endpoint-unavailable") {
            throw new OpenRouterClientError(
              "provider",
              "OpenRouter audit provider has no eligible endpoint.",
              true,
              explicitStatus,
              undefined,
              errorOptions,
            );
          }
          if (explicitStatus === 408 || explicitStatus === 504) {
            throw new OpenRouterClientError(
              "timeout",
              "OpenRouter audit request exceeded the provider time limit.",
              true,
              explicitStatus,
              undefined,
              errorOptions,
            );
          }
          if (diagnostic === "provider-configuration-rejected") {
            throw new OpenRouterClientError(
              "provider",
              "OpenRouter audit provider rejected the request.",
              true,
              explicitStatus,
              undefined,
              errorOptions,
            );
          }
          if (explicitStatus !== undefined) {
            throw new OpenRouterClientError(
              "provider",
              "OpenRouter audit provider rejected the request.",
              false,
              explicitStatus,
              undefined,
              errorOptions,
            );
          }
        }
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned an invalid audit envelope.", true, undefined, undefined, { ...responseMetadata, cause: envelope.error });
      }

      let content: unknown;
      try {
        content = normalizeAuditContent(
          JSON.parse(envelope.data.choices[0].message.content),
        );
      } catch (error) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned non-JSON audit content.", true, undefined, undefined, { ...responseMetadata, cause: error });
      }
      const parsed = aiDiscoveryResponseSchema.safeParse(content);
      if (!parsed.success) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter audit output violated the schema.", true, undefined, undefined, { ...responseMetadata, cause: parsed.error });
      }

      const usage = envelope.data.usage;
      const requestId =
        response.headers.get("x-openrouter-request-id") ??
        response.headers.get("x-request-id") ??
        undefined;
      const routingMetadata = safeRoutingMetadata(
        isRecord(body)
          ? body.openrouter_metadata ?? body.metadata
          : undefined,
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

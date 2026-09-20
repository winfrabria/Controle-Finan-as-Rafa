import "server-only";
import { buildSourceComparisons } from "@/lib/audit-harness/source-comparisons";
import { verificationHypothesisTransport, verificationSourceIndex } from "@/lib/audit-harness/verification-source-index";

import { z } from "zod";

import {
  AUDIT_VERIFICATION_PROMPT,
  type HarnessClassification,
  type HarnessFinding,
  type HarnessInvoice,
  type VerificationCheckRequest,
  type VerificationResponse,
  type WorkRuleInput,
} from "@/lib/audit-harness";
import { parseVerificationWirePayload, VERIFICATION_WIRE_JSON_SCHEMA } from "@/lib/audit-harness/verification-wire";
import { providerVerificationSchema } from "@/lib/audit-harness/provider-verification-schema";
import { resolveHarnessVerifierReasoningEffort } from "@/lib/audit-harness/versions";
import { getOpenRouterConfig } from "./config";
import { verificationSchemaDiagnostics } from "./schema-diagnostics";
import { OpenRouterClientError } from "./client";
import { readOpenRouterCompletionStream, type CompletionTransport } from "./completion-stream";
import {
  getOpenRouterOutputTokenLimit,
  getOpenRouterProviderDiagnostic,
  getOpenRouterProviderRouting,
  type OpenRouterOutputTokenParameter,
} from "./routing";

const OPENROUTER_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
  })).min(1),
  model: z.string(),
  id: z.string().max(160).optional(),
  provider: z.string().optional(),
  usage: z.object({
    completion_tokens: z.number().optional(),
    cost: z.number().nonnegative().optional(),
    prompt_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
}).passthrough();

const ROUTING_METADATA_KEYS = [
  "model",
  "provider",
  "provider_name",
  "request_id",
  "route",
  "upstream_id",
  "upstream_status",
] as const;

function safeRoutingMetadata(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const entries = ROUTING_METADATA_KEYS.flatMap((key) => {
    const entry = source[key];
    return typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
      ? [[key, typeof entry === "string" ? entry.slice(0, 160) : entry] as const]
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export type VerificationRequest = {
  baseClassification: HarnessClassification;
  expectedChecks: VerificationCheckRequest[];
  expectedPageCount: number | null;
  fileName: string;
  initialFindings: HarnessFinding[];
  invoice: HarnessInvoice;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  signedUrl: string;
  workRules?: WorkRuleInput[];
};

export type VerificationResult = {
  attempts: 1;
  data: VerificationResponse;
  latencyMs: number;
  model: string;
  provider?: string;
  requestId?: string;
  generationId?: string;
  transport?: CompletionTransport;
  routingMetadata?: Record<string, string | number | boolean | null>;
  usage?: {
    completionTokens?: number;
    costUsd?: number;
    promptTokens?: number;
    totalTokens?: number;
  };
};

export interface VerificationClient {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

/** Shared by the actual request and the offline workload preview. The preview
 * must measure the exact text transport, not a cheaper substitute for it. */
export function buildVerificationTextPayload(request: Pick<VerificationRequest,
  "baseClassification" | "expectedChecks" | "expectedPageCount" | "initialFindings" | "invoice" | "workRules">) {
  return {
    expectedChecks: request.expectedChecks.map(({ key, lineNumber, fieldReview, amountReview, amountPair, sourcePair, hypothesisReview }) =>
      ({ key, lineNumber, fieldReview, amountReview, amountPair, sourcePair, hypothesisReview })),
    expectedPageCount: request.expectedPageCount,
    initialFindings: verificationHypothesisTransport(request.initialFindings),
    invoice: verificationSourceIndex(request.invoice),
    invoiceTransport: "SOURCE_INDEX_WITHOUT_EXTRACTED_CONTENT",
    sourceComparisons: buildSourceComparisons(request.invoice),
    workRules: (request.workRules ?? []).map(({ code, name, category, severity, configuration }) =>
      ({ code, name, category, severity, configuration })),
  };
}

type VerificationClientOptions = {
  apiKey: string;
  appUrl?: string;
  fetchImplementation?: typeof fetch;
  maxTokens: number;
  outputTokenParameter?: OpenRouterOutputTokenParameter;
  /** Optional endpoint restriction for measured routing trials. ZDR and strict
   * parameter support remain mandatory regardless of this selection. */
  providerOnly?: string[];
  /** Experimental transport simplification; local validation is unchanged. */
  schemaMode?: "bounded" | "shape-only";
  model: string;
  pdfEngine: string;
  /** Runtime configuration stays high; isolated trials may measure other efforts. */
  reasoningEffort: "low" | "medium" | "high" | "max" | "xhigh";
  timeoutMs: number;
};

function documentPart(request: VerificationRequest) {
  if (request.mimeType === "application/pdf") {
    return {
      type: "file",
      file: { filename: "original-document.pdf", file_data: request.signedUrl },
    } as const;
  }
  return { type: "image_url", image_url: { url: request.signedUrl } } as const;
}

async function safeProviderError(response: Response) {
  const status = response.status;
  const requestId =
    response.headers.get("x-openrouter-request-id") ??
    response.headers.get("x-request-id") ??
    undefined;
  let provider: string | undefined;
  let providerCode: string | undefined;
  let message: string | undefined;
  let routingMetadata:
    | Record<string, string | number | boolean | null>
    | undefined;
  try {
    const body = await response.json() as Record<string, unknown>;
    const error =
      typeof body.error === "object" && body.error !== null
        ? body.error as Record<string, unknown>
        : undefined;
    providerCode =
      error?.code !== undefined
        ? String(error.code).slice(0, 80)
        : undefined;
    message =
      typeof error?.message === "string"
        ? error.message.slice(0, 300)
        : undefined;
    const metadata =
      error?.metadata ?? body.openrouter_metadata ?? body.metadata;
    routingMetadata = safeRoutingMetadata(metadata);
    provider =
      typeof body.provider === "string"
        ? body.provider.slice(0, 160)
        : typeof routingMetadata?.provider_name === "string"
          ? routingMetadata.provider_name
          : undefined;
  } catch {
    // Status and headers remain sufficient when the body is not JSON.
  }
  const details = { provider, requestId, routingMetadata };
  if (status === 408 || status === 504) {
    return new OpenRouterClientError(
      "timeout",
      `OpenRouter verification timed out (HTTP ${status}).`,
      false,
      status,
      undefined,
      {
        ...details,
        ...(providerCode ? { diagnosticDetails: { providerCode } } : {}),
      },
    );
  }
  return new OpenRouterClientError(
    "provider",
    `OpenRouter verification request failed (HTTP ${status}).`,
    false,
    status,
    undefined,
    {
      ...details,
      diagnostic: getOpenRouterProviderDiagnostic({
        message,
        providerCode,
        status,
      }),
      ...(providerCode ? { diagnosticDetails: { providerCode } } : {}),
    },
  );
}

export class OpenRouterVerificationClient implements VerificationClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: VerificationClientOptions) {
    if (options.providerOnly && (options.providerOnly.length < 1 || options.providerOnly.length > 5 ||
      new Set(options.providerOnly).size !== options.providerOnly.length ||
      options.providerOnly.some(provider => !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(provider) || provider.length > 100))) {
      throw new Error("Invalid verifier provider restriction.");
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const received: Partial<VerificationResult> = {};
    const transport: CompletionTransport = { mode: "UNKNOWN", events: 0, contentCharacters: 0, responseComplete: false };

    try {
      const response = await this.fetchImplementation(OPENROUTER_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Metadata": "enabled",
          "X-Title": "WinfraBR Audit Verification",
          ...(this.options.appUrl ? { "HTTP-Referer": this.options.appUrl } : {}),
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: AUDIT_VERIFICATION_PROMPT.system },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: JSON.stringify(buildVerificationTextPayload(request)),
                },
                documentPart(request),
              ],
            },
          ],
          model: this.options.model,
          plugins: [
            ...(request.mimeType === "application/pdf"
              ? [{ id: "file-parser", pdf: { engine: this.options.pdfEngine } }]
              : []),
          ],
          reasoning: { effort: this.options.reasoningEffort, exclude: true },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "audit_verification",
              schema: this.options.schemaMode === "shape-only"
                ? providerVerificationSchema(VERIFICATION_WIRE_JSON_SCHEMA) : VERIFICATION_WIRE_JSON_SCHEMA,
              strict: true,
            },
          },
          provider: { ...getOpenRouterProviderRouting(),
            ...(this.options.providerOnly ? { only: this.options.providerOnly, allow_fallbacks: false } : {}) },
          ...getOpenRouterOutputTokenLimit(this.options.model, this.options.maxTokens, this.options.outputTokenParameter),
          stream: true,
        }),
        signal: controller.signal,
      });

      received.requestId = response.headers.get("x-openrouter-request-id") ?? response.headers.get("x-request-id") ?? undefined;
      received.generationId = response.headers.get("x-generation-id") ?? undefined;
      if (!response.ok) throw await safeProviderError(response);

      let body: unknown;
      try {
        if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
          body = await readOpenRouterCompletionStream(response, { signal: controller.signal, startedAt, transport,
            onMetadata: metadata => {
              if (received.generationId && metadata.id && received.generationId !== metadata.id) {
                throw new OpenRouterClientError("invalid-response", "OpenRouter generation identity changed.", false,
                  undefined, undefined, { diagnostic: "verification-generation-id-mismatch" });
              }
              received.generationId ??= metadata.id;
              received.requestId ??= metadata.id;
              received.model = metadata.model ?? received.model;
              received.provider = metadata.provider ?? received.provider;
              if (metadata.usage) received.usage = { completionTokens: metadata.usage.completion_tokens,
                promptTokens: metadata.usage.prompt_tokens, totalTokens: metadata.usage.total_tokens, costUsd: metadata.usage.cost };
              received.routingMetadata = safeRoutingMetadata(metadata.openrouter_metadata) ?? received.routingMetadata;
            } });
        } else {
          // Some compatible endpoints return a complete JSON body despite stream=true.
          transport.mode = "JSON";
          body = await response.json();
          transport.responseComplete = true;
        }
      } catch (error) {
        if (error instanceof OpenRouterClientError) throw error;
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter returned a non-JSON verification envelope.",
          false,
          undefined,
          undefined,
          { cause: error },
        );
      }
      const envelope = responseSchema.safeParse(body);
      if (!envelope.success) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter returned an invalid verification envelope.",
          false,
          undefined,
          undefined,
          { cause: envelope.error },
        );
      }

      received.requestId ??= envelope.data.id;
      received.generationId ??= envelope.data.id;
      received.provider = envelope.data.provider;
      received.model = envelope.data.model;
      received.usage = envelope.data.usage ? {
        completionTokens: envelope.data.usage.completion_tokens, promptTokens: envelope.data.usage.prompt_tokens,
        totalTokens: envelope.data.usage.total_tokens, costUsd: envelope.data.usage.cost,
      } : undefined;
      let content: unknown;
      try {
        content = JSON.parse(envelope.data.choices[0].message.content);
      } catch (error) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter returned non-JSON verification content.",
          false,
          undefined,
          undefined,
          { cause: error },
        );
      }
      const parsed = parseVerificationWirePayload(content, request.expectedChecks);
      if (!parsed.success) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter verification output violated the schema.",
          false,
          undefined,
          undefined,
          { cause: parsed.error, diagnostic: "verification-schema-invalid",
            diagnosticDetails: { schema: verificationSchemaDiagnostics(parsed.error.issues) } },
        );
      }

      const usage = envelope.data.usage;
      const routingMetadata = safeRoutingMetadata(
        typeof body === "object" && body !== null
          ? ((body as Record<string, unknown>).openrouter_metadata ??
              (body as Record<string, unknown>).metadata)
          : undefined,
      );
      return {
        attempts: 1,
        data: parsed.data,
        latencyMs: Date.now() - startedAt,
        model: envelope.data.model,
        generationId: received.generationId,
        transport,
        provider: envelope.data.provider,
        requestId:
          response.headers.get("x-openrouter-request-id") ??
          response.headers.get("x-request-id") ??
          envelope.data.id ??
          undefined,
        routingMetadata,
        ...(usage
          ? {
              usage: {
                completionTokens: usage.completion_tokens,
                costUsd: usage.cost,
                promptTokens: usage.prompt_tokens,
                totalTokens: usage.total_tokens,
              },
            }
          : {}),
      };
    } catch (error) {
      // Aborting while response.json() consumes the body is also a timeout.
      // Its inner parser catch must not mislabel the deadline as malformed JSON.
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new OpenRouterClientError(
          "timeout",
          "OpenRouter verification timed out.",
          false,
          undefined,
          undefined,
          { cause: error, diagnostic: "verification-deadline-exceeded", latencyMs: Date.now() - startedAt,
            diagnosticDetails: { transport }, generationId: received.generationId,
            model: received.model ?? this.options.model, requestId: received.requestId, provider: received.provider,
            routingMetadata: received.routingMetadata, usage: received.usage },
        );
      }
      if (error instanceof OpenRouterClientError) {
        throw new OpenRouterClientError(error.kind, error.message, error.retryable, error.status, error.retryAfterMs, {
          cause: error, diagnostic: error.diagnostic, diagnosticDetails: { ...error.diagnosticDetails, transport },
          generationId: error.generationId ?? received.generationId,
          latencyMs: Date.now() - startedAt, model: error.model ?? received.model ?? this.options.model,
          provider: error.provider ?? received.provider, requestId: error.requestId ?? received.requestId, routingMetadata: error.routingMetadata ?? received.routingMetadata,
          usage: error.usage ?? received.usage,
        });
      }
      throw new OpenRouterClientError(
        "provider",
        "OpenRouter verification request failed.",
        false,
        undefined,
        undefined,
        { cause: error, latencyMs: Date.now() - startedAt, model: received.model ?? this.options.model,
          requestId: received.requestId, generationId: received.generationId, provider: received.provider,
          usage: received.usage, diagnosticDetails: { transport } },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

let defaultVerificationClient: OpenRouterVerificationClient | undefined;

export function getOpenRouterVerificationClient() {
  const config = getOpenRouterConfig(process.env, "verification");
  defaultVerificationClient ??= new OpenRouterVerificationClient({
    ...config,
    reasoningEffort: resolveHarnessVerifierReasoningEffort(
      config.reasoningEffort,
    ),
  });
  return defaultVerificationClient;
}

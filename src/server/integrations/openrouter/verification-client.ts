import "server-only";

import { z } from "zod";

import {
  AUDIT_VERIFICATION_PROMPT,
  VERIFICATION_JSON_SCHEMA,
  verificationResponseSchema,
  type HarnessClassification,
  type HarnessFinding,
  type HarnessInvoice,
  type VerificationCheckRequest,
  type VerificationResponse,
} from "@/lib/audit-harness";
import { resolveHarnessVerifierReasoningEffort } from "@/lib/audit-harness/versions";
import { getOpenRouterConfig } from "./config";
import { OpenRouterClientError } from "./client";
import {
  getOpenRouterOutputTokenLimit,
  getOpenRouterProviderDiagnostic,
  getOpenRouterProviderRouting,
} from "./routing";

const OPENROUTER_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
  })).min(1),
  model: z.string(),
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
};

export type VerificationResult = {
  attempts: 1;
  data: VerificationResponse;
  latencyMs: number;
  model: string;
  provider?: string;
  requestId?: string;
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

type VerificationClientOptions = {
  apiKey: string;
  appUrl?: string;
  fetchImplementation?: typeof fetch;
  maxTokens: number;
  model: string;
  pdfEngine: string;
  reasoningEffort: "high" | "max" | "xhigh";
  timeoutMs: number;
};

function documentPart(request: VerificationRequest) {
  if (request.mimeType === "application/pdf") {
    return {
      type: "file",
      file: { filename: request.fileName, file_data: request.signedUrl },
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
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

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
                  text: JSON.stringify({
                    baseClassification: request.baseClassification,
                    expectedChecks: request.expectedChecks,
                    expectedPageCount: request.expectedPageCount,
                    initialFindings: request.initialFindings,
                    invoice: request.invoice,
                  }),
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
              schema: VERIFICATION_JSON_SCHEMA,
              strict: true,
            },
          },
          provider: getOpenRouterProviderRouting(),
          ...getOpenRouterOutputTokenLimit(this.options.model, this.options.maxTokens),
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw await safeProviderError(response);

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
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
      const parsed = verificationResponseSchema.safeParse(content);
      if (!parsed.success) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter verification output violated the schema.",
          false,
          undefined,
          undefined,
          { cause: parsed.error },
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
        provider: envelope.data.provider,
        requestId:
          response.headers.get("x-openrouter-request-id") ??
          response.headers.get("x-request-id") ??
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
          { cause: error, diagnostic: "verification-deadline-exceeded", latencyMs: Date.now() - startedAt, model: this.options.model },
        );
      }
      if (error instanceof OpenRouterClientError) {
        throw new OpenRouterClientError(error.kind, error.message, error.retryable, error.status, error.retryAfterMs, {
          cause: error, diagnostic: error.diagnostic, diagnosticDetails: error.diagnosticDetails,
          latencyMs: Date.now() - startedAt, model: error.model ?? this.options.model,
          provider: error.provider, requestId: error.requestId, routingMetadata: error.routingMetadata,
          usage: error.usage,
        });
      }
      throw new OpenRouterClientError(
        "provider",
        "OpenRouter verification request failed.",
        false,
        undefined,
        undefined,
        { cause: error, latencyMs: Date.now() - startedAt, model: this.options.model },
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

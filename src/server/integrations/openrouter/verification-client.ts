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

function safeProviderError(status: number) {
  if (status === 408 || status === 504) {
    return new OpenRouterClientError(
      "timeout",
      `OpenRouter verification timed out (HTTP ${status}).`,
      false,
      status,
    );
  }
  return new OpenRouterClientError(
    "provider",
    `OpenRouter verification request failed (HTTP ${status}).`,
    false,
    status,
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
          max_tokens: this.options.maxTokens,
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
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw safeProviderError(response.status);

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
      if (error instanceof OpenRouterClientError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenRouterClientError(
          "timeout",
          "OpenRouter verification timed out.",
          false,
          undefined,
          undefined,
          { cause: error },
        );
      }
      throw new OpenRouterClientError(
        "provider",
        "OpenRouter verification request failed.",
        false,
        undefined,
        undefined,
        { cause: error },
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

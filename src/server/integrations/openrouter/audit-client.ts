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

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }).passthrough() })).min(1),
  model: z.string(),
  provider: z.string().optional(),
  usage: z.object({
    completion_tokens: z.number().optional(),
    prompt_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cost: z.number().nonnegative().optional(),
  }).optional(),
}).passthrough();

async function readProviderError(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown; code?: unknown; metadata?: Record<string, unknown> };
      message?: unknown;
    };
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.message === "string"
          ? body.message
          : undefined;
    const code = typeof body.error?.code === "string" ? ` (${body.error.code})` : "";
    const metadata = body.error?.metadata;
    const metadataParts = metadata
      ? [metadata.error_type, metadata.provider_code, metadata.provider_name]
          .filter((value): value is string => typeof value === "string")
          .join(", ")
      : "";
    const raw = typeof metadata?.raw === "string" ? `: ${metadata.raw}` : "";
    if (message) {
      const details = metadataParts ? ` [${metadataParts}]` : "";
      return `OpenRouter audit request failed with status ${response.status}${code}: ${message}${details}${raw}`.slice(0, 900);
    }
  } catch {
    // Keep the generic status when the provider body is not JSON.
  }
  return `OpenRouter audit request failed with status ${response.status}.`;
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
  data: AiDiscoveryResponse;
  latencyMs: number;
  model: string;
  provider?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
};

export interface AuditDiscoveryClient {
  discover(request: AuditDiscoveryRequest): Promise<AuditDiscoveryResult>;
}

type Options = Omit<
  ReturnType<typeof getOpenRouterConfig>,
  "pdfModel" | "pdfReasoningEffort" | "reasoningEffort"
> & {
  pdfModel?: string;
  pdfReasoningEffort?: string;
  reasoningEffort?: string;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class OpenRouterAuditDiscoveryClient implements AuditDiscoveryClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: Options) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async discover(request: AuditDiscoveryRequest): Promise<AuditDiscoveryResult> {
    let lastError: OpenRouterClientError | undefined;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const result = await this.performRequest(request);
        return { ...result, attempts: attempt };
      } catch (error) {
        const normalized = this.normalizeError(error);
        lastError = normalized;
        if (!normalized.retryable || attempt === this.options.maxAttempts) throw normalized;
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 5_000));
      }
    }
    throw lastError ?? new OpenRouterClientError("provider", "Audit discovery failed.", false);
  }

  private async performRequest(request: AuditDiscoveryRequest) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImplementation(OPENROUTER_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "WinfraBR Audit Harness",
          ...(this.options.appUrl ? { "HTTP-Referer": this.options.appUrl } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
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
          reasoning: { effort: request.reasoningEffort, exclude: true },
          response_format: {
            type: "json_schema",
            json_schema: { name: "audit_discovery", strict: true, schema: AI_DISCOVERY_JSON_SCHEMA },
          },
          stream: false,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OpenRouterClientError(
          "provider",
          await readProviderError(response),
          RETRYABLE_STATUS_CODES.has(response.status),
          response.status,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned a non-JSON envelope.", true, undefined, undefined, { cause: error });
      }
      const envelope = responseSchema.safeParse(body);
      if (!envelope.success) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned an invalid audit envelope.", true, undefined, undefined, { cause: envelope.error });
      }

      let content: unknown;
      try {
        content = JSON.parse(envelope.data.choices[0].message.content);
      } catch (error) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter returned non-JSON audit content.", true, undefined, undefined, { cause: error });
      }
      const parsed = aiDiscoveryResponseSchema.safeParse(content);
      if (!parsed.success) {
        throw new OpenRouterClientError("invalid-response", "OpenRouter audit output violated the schema.", true, undefined, undefined, { cause: parsed.error });
      }

      const usage = envelope.data.usage;
      return {
        data: parsed.data,
        latencyMs: Date.now() - startedAt,
        model: envelope.data.model,
        provider: envelope.data.provider,
        ...(usage ? { usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          costUsd: usage.cost,
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

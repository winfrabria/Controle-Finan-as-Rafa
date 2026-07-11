import "server-only";

import { z } from "zod";

import {
  INVOICE_EXTRACTION_JSON_SCHEMA,
  INVOICE_EXTRACTION_SYSTEM_PROMPT,
  invoiceExtractionSchema,
  type InvoiceExtraction,
} from "@/lib/integrations/openrouter/extraction-contract";
import {
  getOpenRouterConfig,
  type OpenRouterPdfEngine,
} from "@/server/integrations/openrouter/config";

const OPENROUTER_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

const responseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.string() }).passthrough(),
        }),
      )
      .min(1),
    model: z.string(),
    provider: z.string().optional(),
    usage: z
      .object({
        completion_tokens: z.number().optional(),
        prompt_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export type OpenRouterClientErrorKind =
  | "invalid-response"
  | "provider"
  | "timeout";

export class OpenRouterClientError extends Error {
  constructor(
    public readonly kind: OpenRouterClientErrorKind,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OpenRouterClientError";
  }
}

export type InvoiceExtractionRequest = {
  fileName: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  signedUrl: string;
};

export type InvoiceExtractionResult = {
  attempts: number;
  data: InvoiceExtraction;
  model: string;
  provider?: string;
  usage?: {
    completionTokens?: number;
    promptTokens?: number;
    totalTokens?: number;
  };
};

export interface InvoiceExtractionClient {
  extractInvoice(
    request: InvoiceExtractionRequest,
  ): Promise<InvoiceExtractionResult>;
}

type OpenRouterClientOptions = {
  apiKey: string;
  appUrl?: string;
  fetchImplementation?: typeof fetch;
  maxAttempts: number;
  model: string;
  pdfEngine: OpenRouterPdfEngine;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs: number;
};

function parseRetryAfter(value: string | null) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 5_000);
  }

  const dateDelay = Date.parse(value) - Date.now();
  return Number.isFinite(dateDelay)
    ? Math.min(Math.max(dateDelay, 0), 5_000)
    : undefined;
}

async function readProviderError(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };

    if (typeof body.error?.message === "string") {
      return body.error.message.slice(0, 300);
    }
  } catch {
    // The status code remains sufficient when the provider body is not JSON.
  }

  return "OpenRouter rejected the extraction request.";
}

function createDocumentPart(request: InvoiceExtractionRequest) {
  if (request.mimeType === "application/pdf") {
    return {
      type: "file",
      file: {
        filename: request.fileName,
        file_data: request.signedUrl,
      },
    } as const;
  }

  return {
    type: "image_url",
    image_url: { url: request.signedUrl },
  } as const;
}

export class OpenRouterInvoiceExtractionClient
  implements InvoiceExtractionClient
{
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: OpenRouterClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async extractInvoice(
    request: InvoiceExtractionRequest,
  ): Promise<InvoiceExtractionResult> {
    let lastError: OpenRouterClientError | undefined;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const result = await this.performRequest(request);
        return { ...result, attempts: attempt };
      } catch (error) {
        const normalizedError = this.normalizeError(error);
        lastError = normalizedError;

        if (!normalizedError.retryable || attempt === this.options.maxAttempts) {
          throw normalizedError;
        }

        const retryDelay =
          normalizedError.retryAfterMs ?? Math.min(500 * 2 ** (attempt - 1), 5_000);
        await this.sleep(retryDelay);
      }
    }

    throw lastError ?? new OpenRouterClientError("provider", "Extraction failed.", false);
  }

  private async performRequest(request: InvoiceExtractionRequest) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const payload = {
      model: this.options.model,
      messages: [
        { role: "system", content: INVOICE_EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extraia a nota fiscal anexada conforme o schema.",
            },
            createDocumentPart(request),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "invoice_extraction",
          strict: true,
          schema: INVOICE_EXTRACTION_JSON_SCHEMA,
        },
      },
      stream: false,
      temperature: 0,
      ...(request.mimeType === "application/pdf"
        ? {
            plugins: [
              {
                id: "file-parser",
                pdf: { engine: this.options.pdfEngine },
              },
            ],
          }
        : {}),
    };

    try {
      const response = await this.fetchImplementation(
        OPENROUTER_COMPLETIONS_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "WinfraBR Auditoria de Gastos",
            ...(this.options.appUrl
              ? { "HTTP-Referer": this.options.appUrl }
              : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new OpenRouterClientError(
          "provider",
          await readProviderError(response),
          RETRYABLE_STATUS_CODES.has(response.status),
          response.status,
          parseRetryAfter(response.headers.get("retry-after")),
        );
      }

      let responseBody: unknown;

      try {
        responseBody = await response.json();
      } catch (error) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter returned a non-JSON response envelope.",
          true,
          undefined,
          undefined,
          { cause: error },
        );
      }

      const envelope = responseSchema.safeParse(responseBody);

      if (!envelope.success) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter returned an invalid response envelope.",
          true,
          undefined,
          undefined,
          { cause: envelope.error },
        );
      }

      let parsedContent: unknown;

      try {
        parsedContent = JSON.parse(envelope.data.choices[0].message.content);
      } catch (error) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter returned non-JSON extraction content.",
          true,
          undefined,
          undefined,
          { cause: error },
        );
      }

      const extraction = invoiceExtractionSchema.safeParse(parsedContent);

      if (!extraction.success) {
        throw new OpenRouterClientError(
          "invalid-response",
          "OpenRouter extraction did not match the expected schema.",
          true,
          undefined,
          undefined,
          { cause: extraction.error },
        );
      }

      const usage = envelope.data.usage;

      return {
        data: extraction.data,
        model: envelope.data.model,
        provider: envelope.data.provider,
        ...(usage
          ? {
              usage: {
                completionTokens: usage.completion_tokens,
                promptTokens: usage.prompt_tokens,
                totalTokens: usage.total_tokens,
              },
            }
          : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeError(error: unknown) {
    if (error instanceof OpenRouterClientError) {
      return error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      return new OpenRouterClientError(
        "timeout",
        "OpenRouter extraction timed out.",
        true,
        undefined,
        undefined,
        { cause: error },
      );
    }

    return new OpenRouterClientError(
      "provider",
      "OpenRouter extraction request failed.",
      true,
      undefined,
      undefined,
      { cause: error },
    );
  }
}

let defaultClient: OpenRouterInvoiceExtractionClient | undefined;

export function getOpenRouterInvoiceExtractionClient() {
  if (!defaultClient) {
    try {
      const config = getOpenRouterConfig();
      defaultClient = new OpenRouterInvoiceExtractionClient(config);
    } catch (error) {
      throw new OpenRouterClientError(
        "provider",
        "OpenRouter extraction is not configured.",
        false,
        undefined,
        undefined,
        { cause: error },
      );
    }
  }

  return defaultClient;
}

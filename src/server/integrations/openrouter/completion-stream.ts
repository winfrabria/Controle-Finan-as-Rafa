import { createParser } from "eventsource-parser";
import { z } from "zod";
import { OpenRouterClientError } from "./client";

const usageSchema = z.object({
  completion_tokens: z.number().int().nonnegative().optional(),
  prompt_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
});
const choicesSchema = z.array(z.object({
  index: z.number().int().nonnegative().optional(),
  delta: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }).optional(),
  finish_reason: z.string().nullable().optional(),
}));

export type CompletionTransport = {
  mode: "SSE" | "JSON" | "UNKNOWN";
  events: number;
  contentCharacters: number;
  firstEventMs?: number;
  firstContentMs?: number;
  lastEventMs?: number;
  finishReason?: string;
  providerErrorCode?: number;
  responseComplete: boolean;
};

export type CompletionStreamMetadata = {
  id?: string;
  model?: string;
  provider?: string;
  usage?: z.infer<typeof usageSchema>;
  openrouter_metadata?: unknown;
};

function failure(diagnostic: string, kind: "provider" | "invalid-response" = "invalid-response") {
  // Never put partial content, reasoning, SSE lines or provider error text in errors.
  return new OpenRouterClientError(kind, "OpenRouter streaming response was not complete and valid.", false,
    undefined, undefined, { diagnostic });
}

/** Consume one stream, without reconnecting/retrying or accepting a JSON prefix.
 * SSE framing is delegated to eventsource-parser; the application owns bounded
 * memory, terminal-state validation and safe telemetry. Reasoning is discarded. */
export async function readOpenRouterCompletionStream(response: Response, input: {
  signal: AbortSignal;
  startedAt: number;
  transport: CompletionTransport;
  onMetadata: (metadata: CompletionStreamMetadata) => void;
}) {
  if (!response.body) throw failure("stream-body-missing");
  input.transport.mode = "SSE";
  const metadata: CompletionStreamMetadata = {};
  let content = "";
  let receivedDone = false;
  let wireBytes = 0;
  let terminalFailure: string | null = null;
  let metadataGrace: ReturnType<typeof setTimeout> | undefined;
  const reader = response.body.getReader();
  const parser = createParser({
    maxBufferSize: 1024 * 1024,
    onError: error => {
      if (error.type === "max-buffer-size-exceeded") throw failure("stream-buffer-limit");
      // Unknown SSE fields and retry instructions are not JSON or permission to retry.
    },
    onEvent: event => {
      if (receivedDone) throw failure("stream-data-after-done");
      if (event.data === "[DONE]") { receivedDone = true; return; }
      let raw: unknown;
      try { raw = JSON.parse(event.data); } catch { throw failure("stream-invalid-json"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw failure("stream-invalid-envelope");
      const frame = raw as Record<string, unknown>;
      input.transport.events += 1;
      input.transport.firstEventMs ??= Date.now() - input.startedAt;
      input.transport.lastEventMs = Date.now() - input.startedAt;
      for (const key of ["id", "model", "provider"] as const) {
        const value = frame[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value || value.length > 160) throw failure("stream-invalid-metadata");
        if (key === "id" && metadata.id && metadata.id !== value) throw failure("stream-generation-changed");
        metadata[key] = value;
      }
      input.onMetadata({ ...metadata });
      if (frame.usage !== undefined && frame.usage !== null) {
        const usage = usageSchema.safeParse(frame.usage);
        if (!usage.success) throw failure("stream-invalid-usage");
        metadata.usage = usage.data;
      }
      if (frame.openrouter_metadata !== undefined) metadata.openrouter_metadata = frame.openrouter_metadata;
      input.onMetadata({ ...metadata });
      if (frame.error !== undefined && frame.error !== null) {
        const code = typeof frame.error === "object" && !Array.isArray(frame.error)
          ? (frame.error as Record<string, unknown>).code : undefined;
        // Only HTTP-style numeric codes are safe diagnostics. Never retain the
        // arbitrary error message, raw provider response or an opaque code string.
        const numeric = typeof code === "number" ? code
          : typeof code === "string" && /^[45]\d{2}$/.test(code) ? Number(code) : null;
        if (numeric !== null && Number.isInteger(numeric) && numeric >= 400 && numeric <= 599) {
          input.transport.providerErrorCode = numeric;
        }
        throw failure("stream-provider-error", "provider");
      }
      const choices = choicesSchema.safeParse(frame.choices ?? []);
      if (!choices.success || choices.data.length > 1 || choices.data.some(choice => (choice.index ?? 0) !== 0)) {
        throw failure("stream-invalid-choices");
      }
      for (const choice of choices.data) {
        if (choice.delta?.refusal) throw failure("stream-refusal", "provider");
        const delta = choice.delta?.content;
        if (delta) {
          if (input.transport.finishReason) throw failure("stream-content-after-finish");
          input.transport.firstContentMs ??= Date.now() - input.startedAt;
          content += delta;
          input.transport.contentCharacters = content.length;
          if (content.length > 1024 * 1024) throw failure("stream-content-limit");
        }
        if (choice.finish_reason) {
          if (input.transport.finishReason && input.transport.finishReason !== choice.finish_reason) {
            throw failure("stream-finish-changed");
          }
          input.transport.finishReason = choice.finish_reason;
          if (choice.finish_reason !== "stop") {
            terminalFailure = `stream-finish-${choice.finish_reason === "length" ? "length" : "incomplete"}`;
            // Billing may arrive in the following frame. Preserve it, but never
            // accept truncated content or keep waiting indefinitely for a bill.
            metadataGrace ??= setTimeout(() => { void reader.cancel().catch(() => {}); }, 2000);
          }
        }
      }
    },
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abortRead = () => { void reader.cancel().catch(() => {}); };
  input.signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (!receivedDone) {
      input.signal.throwIfAborted();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch {
        input.signal.throwIfAborted();
        throw failure("stream-read-failed", "provider");
      }
      input.signal.throwIfAborted();
      if (chunk.done) break;
      wireBytes += chunk.value.byteLength;
      if (wireBytes > 8 * 1024 * 1024) throw failure("stream-wire-limit");
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    if (terminalFailure) throw failure(terminalFailure);
    if (!receivedDone || input.transport.finishReason !== "stop" || !content) throw failure("stream-truncated");
    input.transport.responseComplete = true;
    return { ...metadata, choices: [{ message: { content } }] };
  } finally {
    clearTimeout(metadataGrace);
    input.signal.removeEventListener("abort", abortRead);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

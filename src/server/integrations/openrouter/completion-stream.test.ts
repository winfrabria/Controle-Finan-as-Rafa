import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterClientError } from "./client";
import { readOpenRouterCompletionStream, type CompletionStreamMetadata, type CompletionTransport } from "./completion-stream";

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const choice = (content: string | null, finish_reason: string | null = null) => ({ index: 0, delta: { content }, finish_reason });
function body(text: string, fragmentBytes?: number) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const size = fragmentBytes ?? bytes.length;
    for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
function input(signal = new AbortController().signal) {
  const seen: CompletionStreamMetadata[] = [];
  const transport: CompletionTransport = { mode: "JSON", events: 0, contentCharacters: 0, responseComplete: false };
  return { signal, startedAt: Date.now(), transport, seen, onMetadata: (metadata: CompletionStreamMetadata) => { seen.push(metadata); } };
}
async function rejectsStream(text: string, diagnostic: string) {
  const request = input();
  await assert.rejects(readOpenRouterCompletionStream(body(text), request), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.diagnostic, diagnostic);
    assert.equal(request.transport.responseComplete, false);
    return true;
  });
}

test("SSE preserva UTF-8 fragmentado, ignora comentários e não retém reasoning", async () => {
  const request = input();
  const expected = '{"resumo":"Conferência de água"}';
  const result = await readOpenRouterCompletionStream(body(": OPENROUTER PROCESSING\r\n\r\n" +
    frame({ id: "gen-synthetic", model: "synthetic/model", choices: [{ index: 0, delta: { reasoning: "PRIVATE_REASONING" } }] }) +
    frame({ id: "gen-synthetic", choices: [choice(expected)] }) +
    frame({ choices: [choice("", "stop")] }) + "data: [DONE]\n\n", 1), request);
  assert.equal(result.choices[0].message.content, expected);
  assert.equal(result.id, "gen-synthetic");
  assert.equal(JSON.stringify(result).includes("PRIVATE_REASONING"), false);
  assert.equal(JSON.stringify(request.seen).includes("PRIVATE_REASONING"), false);
  assert.equal(request.transport.responseComplete, true);
  assert.equal(request.transport.contentCharacters, expected.length);
  assert.ok(request.transport.firstEventMs !== undefined && request.transport.firstContentMs !== undefined);
});

test("SSE aceita data multilinha e frame de cobrança com finish_reason repetido", async () => {
  const request = input();
  const result = await readOpenRouterCompletionStream(body('data: {"id":"gen-synthetic",\r\ndata: "model":"synthetic/model","choices":[]}\r\n\r\n' +
    frame({ choices: [choice("{}", "stop")] }) + frame({ choices: [choice("", "stop")],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.001 } }) + "data: [DONE]\n\n"), request);
  assert.equal(result.usage?.cost, 0.001);
  assert.equal(result.choices[0].message.content, "{}");
  assert.equal(request.seen.at(-1)?.usage?.total_tokens, 30);
});

test("SSE também aceita usage com choices vazio e custo zero informado", async () => {
  const result = await readOpenRouterCompletionStream(body(frame({ choices: [choice("{}", "stop")] }) +
    frame({ choices: [], usage: { cost: 0 } }) + "data: [DONE]\n\n"), input());
  assert.equal(result.usage?.cost, 0);
});

test("JSON de conteúdo completo sem marcador terminal não vira resposta concluída", async () => {
  await rejectsStream(frame({ choices: [choice("{}", "stop")] }), "stream-truncated");
  await rejectsStream(frame({ choices: [choice("{}")] }) + "data: [DONE]\n\n", "stream-truncated");
});

test("length, troca de geração e conteúdo posterior ao fim são rejeitados", async () => {
  await rejectsStream(frame({ choices: [choice("{}", "length")] }) + "data: [DONE]\n\n", "stream-finish-length");
  await rejectsStream(frame({ id: "gen-one" }) + frame({ id: "gen-two" }), "stream-generation-changed");
  await rejectsStream(frame({ choices: [choice("{}", "stop")] }) + frame({ choices: [choice("more")] }), "stream-content-after-finish");
});

test("length continua inválido mas preserva cobrança no frame posterior", async () => {
  const request = input();
  await assert.rejects(readOpenRouterCompletionStream(body(
    frame({ id: "gen-length", choices: [choice("{", "length")] }) +
    frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32, cost: 0.003 } }) +
    "data: [DONE]\n\n", 13), request), (error: unknown) => {
      assert.ok(error instanceof OpenRouterClientError);
      assert.equal(error.diagnostic, "stream-finish-length"); return true;
    });
  assert.equal(request.seen.at(-1)?.usage?.cost, 0.003);
  assert.equal(request.transport.responseComplete, false);
});

test("length sem trailer encerra a espera e nunca aceita a saída parcial", async () => {
  const request = input(); let cancelled = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ start(stream) {
    stream.enqueue(new TextEncoder().encode(frame({ id: "gen-length-pending", choices: [choice("{", "length")] })));
  }, cancel() { cancelled += 1; } }));
  await assert.rejects(readOpenRouterCompletionStream(response, request), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.diagnostic, "stream-finish-length"); return true;
  });
  assert.equal(cancelled, 1);
  assert.equal(request.transport.responseComplete, false);
  assert.equal(request.seen.at(-1)?.usage?.cost, undefined, "Missing billing is unknown, not zero.");
});

test("erro no primeiro evento HTTP 200 mantém metadados e nunca retorna um sucesso", async () => {
  const request = input();
  await assert.rejects(readOpenRouterCompletionStream(body(frame({ id: "gen-failure", provider: "synthetic",
    usage: { cost: 0.02 }, error: { message: "PRIVATE_PROVIDER_MESSAGE", code: "server_error" } })), request), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.kind, "provider"); assert.equal(error.diagnostic, "stream-provider-error");
    assert.equal(JSON.stringify(error).includes("PRIVATE_PROVIDER_MESSAGE"), false);
    return true;
  });
  assert.equal(request.seen.at(-1)?.id, "gen-failure");
  assert.equal(request.seen.at(-1)?.usage?.cost, 0.02);
});

test("envelope, JSON, índice, recusa e cobrança inválidos falham de forma fechada", async () => {
  await rejectsStream("data: not-json\n\n", "stream-invalid-json");
  await rejectsStream(frame([]), "stream-invalid-envelope");
  await rejectsStream(frame({ choices: [{ index: 1, delta: { content: "{}" } }] }), "stream-invalid-choices");
  await rejectsStream(frame({ choices: [{ delta: { refusal: "PRIVATE_REFUSAL" } }] }), "stream-refusal");
  await rejectsStream(frame({ usage: { cost: -1 } }), "stream-invalid-usage");
});

test("erro SSE registra somente código numérico seguro, sem conteúdo bruto do provedor", async () => {
  for (const code of [429, "503", "PRIVATE_CODE", 200, 999, "500 PRIVATE", { secret: "PRIVATE" }]) {
    const request = input();
    await assert.rejects(readOpenRouterCompletionStream(body(frame({ error: { code,
      message: "PRIVATE_MESSAGE", metadata: { raw: "PRIVATE_BODY" } } })), request));
    assert.equal(request.transport.providerErrorCode, code === 429 ? 429 : code === "503" ? 503 : undefined);
    assert.equal(JSON.stringify({ transport: request.transport, metadata: request.seen }).includes("PRIVATE"), false);
  }
});

test("timeout interrompe leitor pendente sem reabrir conexão ou aprovar conteúdo parcial", async () => {
  const controller = new AbortController(); const request = input(controller.signal); let cancelled = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ start(stream) {
    stream.enqueue(new TextEncoder().encode(frame({ id: "gen-timeout", choices: [choice("{\"partial\":")] })));
  }, cancel() { cancelled += 1; } }));
  const pending = readOpenRouterCompletionStream(response, request);
  setTimeout(() => controller.abort(new DOMException("Aborted", "AbortError")), 10);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, 1);
  assert.equal(request.transport.responseComplete, false);
  assert.equal(request.seen.at(-1)?.id, "gen-timeout");
});

test("evento sem término e conteúdo acumulado têm limites independentes de memória", async () => {
  await rejectsStream("data: " + "x".repeat(1024 * 1024 + 1), "stream-buffer-limit");
  await rejectsStream([1, 2, 3].map(() => frame({ choices: [choice("x".repeat(400_000))] })).join(""), "stream-content-limit");
});

test("queda do transporte não se disfarça de JSON inválido nem perde a geração conhecida", async () => {
  const request = input(); let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(stream) {
    if (pulls++ === 0) stream.enqueue(new TextEncoder().encode(frame({ id: "gen-interrupted", choices: [choice("{")] })));
    else stream.error(new Error("PRIVATE_NETWORK_DETAILS"));
  } }));
  await assert.rejects(readOpenRouterCompletionStream(response, request), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.kind, "provider"); assert.equal(error.diagnostic, "stream-read-failed");
    assert.equal(JSON.stringify(error).includes("PRIVATE_NETWORK_DETAILS"), false); return true;
  });
  assert.equal(request.seen.at(-1)?.id, "gen-interrupted");
  assert.equal(request.seen.at(-1)?.usage, undefined);
  assert.equal(request.transport.responseComplete, false);
});

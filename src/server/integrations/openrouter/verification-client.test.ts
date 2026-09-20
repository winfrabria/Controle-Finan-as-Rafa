import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterClientError } from "./client";

import {
  OpenRouterVerificationClient,
  buildVerificationTextPayload,
  type VerificationRequest,
} from "./verification-client";

function request(): VerificationRequest {
  return {
    baseClassification: "OK",
    expectedChecks: [
      { documentGroup: null, documentRole: null, key: "document:coverage", lineNumber: null },
      { documentGroup: null, documentRole: null, key: "document:total", lineNumber: null },
    ],
    expectedPageCount: 1,
    fileName: "documento.pdf",
    initialFindings: [],
    invoice: {
      documentKind: "FISCAL_INVOICE",
      documentNumber: "1",
      issuedAt: "2026-08-25",
      items: [],
      markdown: "Documento legível com total de R$ 10,00.",
      readConfidence: 0.9,
      supplierName: "Fornecedor",
      supplierTaxId: null,
      totalAmount: "10.00",
      warnings: [],
    },
    mimeType: "application/pdf",
    signedUrl: "https://storage.example/signed?token=secret",
  };
}

function validContent() {
  return {
    checks: request().expectedChecks.map((check) => ({
      key: check.key,
      evidence: [{ page: 1, field: "total", quote: "Total R$ 10,00.", source: "Original sintético" }],
      findingCode: null,
      limitationCode: null,
      state: "VERIFIED",
    })),
    findings: [],
    limitations: [],
    pageCoverage: {
      checkedPages: [1],
      expectedPageCount: 1,
      missingPages: [],
      status: "COMPLETE",
    },
    status: "PASS",
    summary: "Documento conferido.",
  };
}

test("pedido de conciliação transporta somente localizadores das duas fontes, não valores esperados", () => {
  const input = request();
  input.expectedChecks.push({ key: "amount-pair:7:1:2", lineNumber: 7, documentGroup: null, documentRole: null,
    amountPair: { sources: [{ kind: "SALE", page: 1 }, { kind: "PAYMENT", page: 1 }] } });
  const output = buildVerificationTextPayload(input);
  assert.deepEqual(output.expectedChecks.at(-1)?.amountPair, input.expectedChecks.at(-1)?.amountPair);
  assert.equal(JSON.stringify(output).includes("10.00"), false);
});

test("ensaio de esforço baixo mantém PDF, schema estrito e privacidade sem fallback", async () => {
  let calls = 0;
  const client = new OpenRouterVerificationClient({ apiKey: "synthetic", model: "google/gemini-3.8-flash",
    maxTokens: 16384, pdfEngine: "native", reasoningEffort: "low", timeoutMs: 1000,
    fetchImplementation: async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.deepEqual(payload.reasoning, { effort: "low", exclude: true });
      assert.equal(payload.response_format.json_schema.strict, true);
      assert.deepEqual(payload.provider, { require_parameters: true, sort: "latency", zdr: true });
      assert.equal(payload.messages[1].content[1].file.file_data, request().signedUrl);
      assert.equal(payload.max_tokens, 16384);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validContent()) } }],
        model: "google/gemini-3.8-flash" }), { headers: { "content-type": "application/json" } });
    } });
  assert.equal((await client.verify(request())).data.checks.length, 2);
  assert.equal(calls, 1);
});

test("verificador recebe configuração das regras sem transportar campos internos do cadastro", () => {
  assert.deepEqual(buildVerificationTextPayload(request()).workRules, []);
  const rule = { code: "ALLOWED_TYPES", name: "Tipos", category: "PRODUCT", severity: "WARNING" as const,
    configuration: { allowed: ["Tipo A"], limit: 0, nested: { active: false } },
    internalOwnerEmail: "private@example.invalid", workId: "internal-id" };
  assert.deepEqual(buildVerificationTextPayload({ ...request(), workRules: [rule] }).workRules,
    [{ code: rule.code, name: rule.name, category: rule.category, severity: rule.severity, configuration: rule.configuration }]);
});

test("restrição regional preserva ZDR e suporte de parâmetros, sem fallback para outra rota", async () => {
  let calls = 0;
  const options = { apiKey: "synthetic", model: "openai/gpt-5.6-sol", maxTokens: 16384,
    pdfEngine: "native", reasoningEffort: "high" as const, timeoutMs: 1000, providerOnly: ["azure/eu"],
    fetchImplementation: async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.deepEqual(payload.provider, { zdr: true, require_parameters: true, sort: "latency",
        only: ["azure/eu"], allow_fallbacks: false });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validContent()) } }],
        model: "openai/gpt-5.6-sol", provider: "synthetic" }), { headers: { "content-type": "application/json" } });
    } };
  const result = await new OpenRouterVerificationClient(options).verify(request());
  assert.equal(result.data.status, "PASS"); assert.equal(calls, 1);
  for (const providerOnly of [[], ["azure/eu", "azure/eu"], ["https://unknown.invalid"], [" "]])
    assert.throws(() => new OpenRouterVerificationClient({ ...options, providerOnly }), /provider restriction/);
  assert.equal(calls, 1);
});

for (const outputTokenParameter of [undefined, "max_tokens", "max_completion_tokens"] as const) {
test(`verificador usa Sol high uma vez e exclui reasoning da resposta (${outputTokenParameter ?? "padrão"})`, async () => {
  let calls = 0;
  let payload: Record<string, unknown> | undefined;
  const client = new OpenRouterVerificationClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      calls += 1;
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validContent()) } }],
        model: "openai/gpt-5.6-sol",
        provider: "test-provider",
        usage: { completion_tokens: 10, prompt_tokens: 20, total_tokens: 30, cost: 0.01 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    maxTokens: 16_384,
    outputTokenParameter,
    model: "openai/gpt-5.6-sol",
    pdfEngine: "mistral-ocr",
    reasoningEffort: "high",
    timeoutMs: 5_000,
  });

  const result = await client.verify(request());
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.data.checks[0].documentGroup, null);
  assert.equal(result.data.checks[0].lineNumber, null);
  assert.equal(payload?.model, "openai/gpt-5.6-sol");
  assert.equal(payload?.stream, true);
  const expectedParameter = outputTokenParameter ?? "max_completion_tokens";
  assert.equal(payload?.[expectedParameter], 16_384);
  assert.equal((expectedParameter === "max_tokens" ? "max_completion_tokens" : "max_tokens") in (payload ?? {}), false);
  assert.deepEqual(payload?.provider, {
    require_parameters: true,
    sort: "latency",
    zdr: true,
  });
  assert.deepEqual(payload?.reasoning, { effort: "high", exclude: true });
  assert.equal(JSON.stringify(payload).includes("uniqueItems"), false);
  assert.equal(JSON.stringify(payload).includes("response-healing"), false);
  const messages = payload?.messages as Array<{ content: string | Array<{ type: string; text?: string; file?: unknown }> }>;
  const content = messages[1].content as Array<{ type: string; text?: string; file?: unknown }>;
  const transport = JSON.parse(content[0].text!);
  assert.equal(transport.invoiceTransport, "SOURCE_INDEX_WITHOUT_EXTRACTED_CONTENT");
  assert.equal("supplierTaxId" in transport.invoice, false);
  assert.equal("markdown" in transport.invoice, false);
  assert.deepEqual(transport.invoice.items, []);
  assert.equal("warnings" in transport.invoice, false);
  assert.equal("baseClassification" in transport, false);
  assert.deepEqual(transport.expectedChecks, request().expectedChecks.map(({ key, lineNumber }) => ({ key, lineNumber })));
  assert.deepEqual(transport.initialFindings, []);
  assert.deepEqual(transport.sourceComparisons, { candidates: [], ambiguousMeasureGroups: 0 });
  assert.deepEqual(content[1].file, { filename: "original-document.pdf", file_data: request().signedUrl });
});
}

test("erro do provedor não abre retry ou fallback", async () => {
  let calls = 0;
  const client = new OpenRouterVerificationClient({
    apiKey: "test-key",
    fetchImplementation: async () => {
      calls += 1;
      return new Response("{}", { status: 503 });
    },
    maxTokens: 16_384,
    model: "openai/gpt-5.6-sol",
    pdfEngine: "mistral-ocr",
    reasoningEffort: "high",
    timeoutMs: 5_000,
  });
  await assert.rejects(() => client.verify(request()), /verification request failed/i);
  assert.equal(calls, 1);
});

test("timeout ao consumir corpo HTTP 200 não vira resposta JSON inválida", async () => {
  let calls = 0;
  const client = new OpenRouterVerificationClient({
    apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "mistral-ocr", reasoningEffort: "high", timeoutMs: 20,
    fetchImplementation: async (_url, init) => {
      calls++;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":'));
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      } }), { status: 200 });
    },
  });
  await assert.rejects(client.verify(request()), (error: unknown) => {
    assert.ok(error && typeof error === "object" && "kind" in error && "latencyMs" in error && "diagnostic" in error);
    assert.equal(error.kind, "timeout");
    assert.equal(error.diagnostic, "verification-deadline-exceeded");
    assert.ok(Number(error.latencyMs) >= 15);
    return true;
  });
  assert.equal(calls, 1);
});

test("resposta inválida mantém ID de geração e cobrança já informada, sem expor completion", async () => {
  const client = new OpenRouterVerificationClient({ apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "native", reasoningEffort: "high", timeoutMs: 2000,
    fetchImplementation: async () => new Response(JSON.stringify({ id: "gen-synthetic-billing-id", model: "openai/gpt-5.6-sol",
      provider: "synthetic", usage: { cost: 0.012, total_tokens: 40 },
      choices: [{ message: { content: "invalid sensitive completion" } }] })),
  });
  await assert.rejects(client.verify(request()), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.requestId, "gen-synthetic-billing-id");
    assert.equal(error.usage?.costUsd, 0.012); assert.equal(error.usage?.totalTokens, 40);
    assert.equal(error.provider, "synthetic");
    assert.equal(JSON.stringify(error).includes("invalid sensitive completion"), false);
    return true;
  });
});

test("verificador integra SSE completo ao mesmo contrato de conferências, com ID e custo", async () => {
  const content = JSON.stringify(validContent());
  const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const client = new OpenRouterVerificationClient({ apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "native", reasoningEffort: "high", timeoutMs: 2000,
    fetchImplementation: async () => new Response(frame({ id: "gen-synthetic-stream", model: "openai/gpt-5.6-sol",
      provider: "synthetic", choices: [{ index: 0, delta: { content }, finish_reason: "stop" }] }) +
      frame({ choices: [], usage: { cost: 0.01, total_tokens: 100 } }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "X-Generation-Id": "gen-synthetic-stream", "X-Request-Id": "req-synthetic" } }),
  });
  const result = await client.verify(request());
  assert.equal(result.data.status, "PASS");
  assert.equal(result.data.checks.length, 2);
  assert.equal(result.usage?.costUsd, 0.01);
  assert.equal(result.generationId, "gen-synthetic-stream");
  assert.equal(result.requestId, "req-synthetic");
  assert.equal(result.transport?.mode, "SSE");
  assert.equal(result.transport?.responseComplete, true);
  assert.equal(result.transport?.contentCharacters, content.length);
});

test("falha de schema identifica o campo sem registrar o valor inválido", async () => {
  const client = new OpenRouterVerificationClient({ apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "native", reasoningEffort: "high", timeoutMs: 2000,
    fetchImplementation: async () => new Response(JSON.stringify({ id: "gen-schema", model: "openai/gpt-5.6-sol",
      usage: { cost: 0.01 }, choices: [{ message: { content: JSON.stringify({ ...validContent(), status: "PRIVATE_VALUE" }) } }] })),
  });
  await assert.rejects(client.verify(request()), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.diagnostic, "verification-schema-invalid");
    assert.deepEqual(error.diagnosticDetails?.schema, { issueCount: 1, issues: [{ code: "invalid_value", path: ["status"] }] });
    assert.equal(JSON.stringify(error).includes("PRIVATE_VALUE"), false);
    assert.equal(error.usage?.costUsd, 0.01);
    return true;
  });
});

test("verificador preserva ID e progresso ao expirar SSE, sem expor texto parcial", async () => {
  let calls = 0; let cancelled = 0;
  const client = new OpenRouterVerificationClient({ apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "native", reasoningEffort: "high", timeoutMs: 30,
    fetchImplementation: async () => {
      calls += 1;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"gen-timeout","provider":"synthetic","choices":[{"delta":{"content":"PRIVATE_PARTIAL"}}]}\n\n'));
      }, cancel() { cancelled += 1; } }), { headers: { "Content-Type": "text/event-stream", "X-Generation-Id": "gen-timeout" } });
    },
  });
  await assert.rejects(client.verify(request()), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.kind, "timeout");
    assert.equal(error.generationId, "gen-timeout");
    assert.equal(error.provider, "synthetic");
    assert.equal(error.usage?.costUsd, undefined);
    const transport = error.diagnosticDetails?.transport as { responseComplete: boolean; contentCharacters: number };
    assert.equal(transport.responseComplete, false); assert.equal(transport.contentCharacters, 15);
    assert.equal(JSON.stringify(error).includes("PRIVATE_PARTIAL"), false);
    return true;
  });
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test("metadado de outra geração não é aceito para cobrança ou confirmação", async () => {
  const client = new OpenRouterVerificationClient({ apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "native", reasoningEffort: "high", timeoutMs: 2000,
    fetchImplementation: async () => new Response('data: {"id":"gen-other","usage":{"cost":99}}\n\n',
      { headers: { "Content-Type": "text/event-stream", "X-Generation-Id": "gen-expected" } }),
  });
  await assert.rejects(client.verify(request()), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.diagnostic, "verification-generation-id-mismatch");
    assert.equal(error.generationId, "gen-expected");
    assert.equal(error.usage?.costUsd, undefined);
    return true;
  });
});

test("erro upstream em HTTP 200 preserva o código seguro sem retry nem mensagem privada", async () => {
  let calls = 0;
  const client = new OpenRouterVerificationClient({ apiKey: "offline-key", model: "openai/gpt-5.6-sol", maxTokens: 1024,
    pdfEngine: "native", reasoningEffort: "high", timeoutMs: 2000,
    fetchImplementation: async () => { calls += 1; return new Response('data: {"id":"gen-failed","error":{"code":503,"message":"PRIVATE_MESSAGE"}}\n\n',
      { headers: { "Content-Type": "text/event-stream" } }); },
  });
  await assert.rejects(client.verify(request()), (error: unknown) => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.kind, "provider");
    assert.equal(error.diagnosticDetails?.transport && (error.diagnosticDetails.transport as { providerErrorCode?: number }).providerErrorCode, 503);
    assert.equal(error.generationId, "gen-failed");
    assert.equal(JSON.stringify(error).includes("PRIVATE_MESSAGE"), false);
    return true;
  });
  assert.equal(calls, 1);
});

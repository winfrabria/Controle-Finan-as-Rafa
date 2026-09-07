import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenRouterVerificationClient,
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
      ...check,
      evidence: [],
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

test("verificador usa Sol high uma vez e exclui reasoning da resposta", async () => {
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
    model: "openai/gpt-5.6-sol",
    pdfEngine: "mistral-ocr",
    reasoningEffort: "high",
    timeoutMs: 5_000,
  });

  const result = await client.verify(request());
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(payload?.model, "openai/gpt-5.6-sol");
  assert.equal(payload?.max_completion_tokens, 16_384);
  assert.equal("max_tokens" in (payload ?? {}), false);
  assert.deepEqual(payload?.provider, {
    require_parameters: true,
    sort: "latency",
    zdr: true,
  });
  assert.deepEqual(payload?.reasoning, { effort: "high", exclude: true });
  assert.equal(JSON.stringify(payload).includes("uniqueItems"), false);
  assert.equal(JSON.stringify(payload).includes("response-healing"), false);
});

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

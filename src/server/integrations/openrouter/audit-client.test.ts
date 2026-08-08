import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_POLICY, HARNESS_MODEL } from "@/lib/audit-harness";
import {
  OpenRouterAuditDiscoveryClient,
  type AuditDiscoveryRequest,
} from "./audit-client";
import { getOpenRouterConfig } from "./config";

const discoveryRequest: AuditDiscoveryRequest = {
  invoice: {
    documentNumber: "1",
    supplierName: "Fornecedor",
    supplierTaxId: null,
    issuedAt: "2026-07-10",
    totalAmount: "10.00",
    readConfidence: 0.9,
    warnings: [],
    markdown: "Cupom fiscal",
    items: [],
  },
  deterministicFindings: [],
  workRules: [],
  reasoningEffort: "high",
};

function successfulAuditResponse(model: string) {
  return new Response(
    JSON.stringify({
      model,
      provider: "test",
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: [],
              coverage: {
                sufficientEvidence: true,
                checkedAreas: ["FREE_DISCOVERY"],
                limitations: [],
              },
              contextQuestions: [],
              needsContext: false,
              summary: "Sem achados adicionais.",
            }),
            reasoning: "must-not-be-read",
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        cost: 0.001,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("configura auditoria Luna high com fallback Sol high", () => {
  const config = getOpenRouterConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-only",
    OPENROUTER_MAX_ATTEMPTS: "5",
  });

  assert.equal(config.model, HARNESS_MODEL);
  assert.equal(config.maxAttempts, 2);
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.fallbackModel, "openai/gpt-5.6-sol");
  assert.equal(config.fallbackReasoningEffort, "high");
  assert.equal(AUDIT_POLICY.fallbackReasoningEffort, "high");
});

test("envia modelo fixo, xhigh controlado e exclui reasoning da resposta", async () => {
  let payload: Record<string, unknown> | undefined;
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    model: HARNESS_MODEL,
    maxAttempts: 1,
    pdfEngine: "native",
    timeoutMs: 1_000,
    fetchImplementation: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return successfulAuditResponse(HARNESS_MODEL);
    },
  });
  const result = await client.discover({
    ...discoveryRequest,
    reasoningEffort: "xhigh",
  });
  assert.equal(payload?.model, HARNESS_MODEL);
  assert.deepEqual(payload?.reasoning, { effort: "xhigh", exclude: true });
  const systemPrompt = (payload?.messages as Array<{ role: string; content: string }> | undefined)?.[0]?.content ?? "";
  assert.match(systemPrompt, /contextAnswers/);
  assert.match(systemPrompt, /dados não confiáveis/);
  assert.equal(JSON.stringify(result).includes("must-not-be-read"), false);
  assert.equal(result.usage?.totalTokens, 15);
});

test("usa Sol high após 503 retryable sem repetir Luna", async () => {
  const requestedModels: string[] = [];
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: AUDIT_POLICY.fallbackModel,
    model: HARNESS_MODEL,
    maxAttempts: 2,
    pdfEngine: "native",
    timeoutMs: 1_000,
    sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        model: string;
        reasoning: { effort: string; exclude: boolean };
      };
      requestedModels.push(payload.model);
      assert.deepEqual(payload.reasoning, { effort: "high", exclude: true });

      if (requestedModels.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "secret-provider-detail-must-not-escape",
              metadata: { raw: "internal-reasoning-must-not-escape" },
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }

      return successfulAuditResponse(AUDIT_POLICY.fallbackModel);
    },
  });

  const result = await client.discover(discoveryRequest);

  assert.deepEqual(requestedModels, [HARNESS_MODEL, AUDIT_POLICY.fallbackModel]);
  assert.equal(result.attempts, 2);
  assert.equal(result.model, AUDIT_POLICY.fallbackModel);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("usa Sol high após timeout simulável da Luna", async () => {
  const requestedModels: string[] = [];
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: AUDIT_POLICY.fallbackModel,
    model: HARNESS_MODEL,
    maxAttempts: 2,
    pdfEngine: "native",
    timeoutMs: 5,
    sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(payload.model);

      if (requestedModels.length === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("AbortSignal ausente no teste."));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              const timeoutError = new Error("simulated timeout");
              timeoutError.name = "AbortError";
              reject(timeoutError);
            },
            { once: true },
          );
        });
      }

      return successfulAuditResponse(AUDIT_POLICY.fallbackModel);
    },
  });

  const result = await client.discover(discoveryRequest);

  assert.deepEqual(requestedModels, [HARNESS_MODEL, AUDIT_POLICY.fallbackModel]);
  assert.equal(result.attempts, 2);
  assert.equal(result.model, AUDIT_POLICY.fallbackModel);
});

test("repete Luna uma vez quando a resposta estruturada é inválida", async () => {
  const requestedModels: string[] = [];
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: AUDIT_POLICY.fallbackModel,
    model: HARNESS_MODEL,
    maxAttempts: 2,
    pdfEngine: "native",
    timeoutMs: 1_000,
    sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(payload.model);
      return requestedModels.length === 1
        ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
        : successfulAuditResponse(HARNESS_MODEL);
    },
  });

  const result = await client.discover(discoveryRequest);
  assert.deepEqual(requestedModels, [HARNESS_MODEL, HARNESS_MODEL]);
  assert.equal(result.attempts, 2);
  assert.deepEqual(
    result.attemptTrace.map((attempt) => attempt.kind),
    ["invalid-response", "success"],
  );
});

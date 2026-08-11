import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_POLICY,
  HARNESS_MODEL,
  HARNESS_PDF_MODEL,
} from "@/lib/audit-harness";
import {
  normalizeAuditContent,
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

test("configura auditoria Terra high com recuperação no mesmo modelo", () => {
  const config = getOpenRouterConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-only",
    OPENROUTER_MAX_ATTEMPTS: "5",
  });

  assert.equal(config.model, HARNESS_MODEL);
  assert.equal(config.maxAttempts, 2);
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.fallbackModel, HARNESS_MODEL);
  assert.equal(config.fallbackReasoningEffort, "high");
  assert.equal(config.maxTokens, 8_192);
  assert.equal(AUDIT_POLICY.fallbackReasoningEffort, "high");
});

test("configura Gemini high para um ciclo controlado de comparação", () => {
  const config = getOpenRouterConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-only",
    OPENROUTER_AUDIT_MODEL: "google/gemini-3.6-flash",
    OPENROUTER_AUDIT_REASONING_EFFORT: "high",
  });

  assert.equal(config.model, "google/gemini-3.6-flash");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.fallbackModel, HARNESS_MODEL);
});

test("configura Gemini high também para extração e leitura de PDF", () => {
  const config = getOpenRouterConfig(
    {
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-only",
      OPENROUTER_EXTRACTION_MODEL: "google/gemini-3.6-flash",
      OPENROUTER_EXTRACTION_REASONING_EFFORT: "high",
      OPENROUTER_PDF_MODEL: "google/gemini-3.6-flash",
      OPENROUTER_PDF_REASONING_EFFORT: "high",
    },
    "extraction",
  );

  assert.equal(config.model, "google/gemini-3.6-flash");
  assert.equal(config.pdfModel, "google/gemini-3.6-flash");
  assert.equal(config.pdfFallbackModel, HARNESS_PDF_MODEL);
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.pdfReasoningEffort, "high");
});

test("usa Terra high tanto na extração quanto na auditoria", () => {
  const config = getOpenRouterConfig(
    {
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-only",
    },
    "extraction",
  );

  assert.equal(config.model, HARNESS_MODEL);
  assert.equal(config.pdfModel, HARNESS_PDF_MODEL);
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.pdfReasoningEffort, "high");
  assert.equal(config.timeoutMs, 120_000);
  assert.equal(config.maxTokens, 8_192);
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
  assert.equal(payload?.max_tokens, 8_192);
  assert.deepEqual(payload?.provider, { require_parameters: true });
  assert.equal("temperature" in (payload ?? {}), false);
  assert.equal("tools" in (payload ?? {}), false);
  const systemPrompt = (payload?.messages as Array<{ role: string; content: string }> | undefined)?.[0]?.content ?? "";
  assert.match(systemPrompt, /contextAnswers/);
  assert.match(systemPrompt, /dados não confiáveis/);
  assert.equal(JSON.stringify(result).includes("must-not-be-read"), false);
  assert.equal(result.usage?.totalTokens, 15);
});

test("oferece pesquisa web seletiva com limite rígido quando habilitada", async () => {
  let payload: Record<string, unknown> | undefined;
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    model: HARNESS_MODEL,
    maxAttempts: 1,
    pdfEngine: "native",
    timeoutMs: 1_000,
    webSearchEnabled: true,
    webSearchMaxResults: 3,
    fetchImplementation: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return successfulAuditResponse(HARNESS_MODEL);
    },
  });

  await client.discover(discoveryRequest);
  assert.equal(payload?.max_tool_calls, 1);
  assert.deepEqual(payload?.tools, [{
    type: "openrouter:web_search",
    parameters: {
      engine: "auto",
      max_results: 3,
      max_total_results: 3,
      max_uses: 1,
      search_context_size: "low",
    },
  }]);
});

test("corrige options indevidas em pergunta textual sem gastar um retry", async () => {
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    model: HARNESS_MODEL,
    maxAttempts: 1,
    pdfEngine: "native",
    timeoutMs: 1_000,
    fetchImplementation: async () => new Response(JSON.stringify({
      model: HARNESS_MODEL,
      choices: [{ message: { content: JSON.stringify({
        findings: [],
        coverage: {
          sufficientEvidence: false,
          checkedAreas: ["OBRA"],
          limitations: ["Falta contexto da obra."],
        },
        contextQuestions: [{
          code: "CTX-001",
          options: [{ label: "Outro", value: "outro" }],
          prompt: "Qual é o equipamento relacionado?",
          rationale: "A resposta altera a verificação de compatibilidade.",
          required: true,
          type: "TEXT",
        }],
        needsContext: true,
        summary: "É necessário confirmar o equipamento.",
      }) } }],
    }), { status: 200 }),
  });

  const result = await client.discover(discoveryRequest);
  assert.deepEqual(result.data.contextQuestions[0]?.options, []);
  assert.equal(result.attempts, 1);
});

test("descarta pergunta que transfere a definição de política para quem envia", () => {
  const normalized = normalizeAuditContent({
    contextQuestions: [{
      code: "CTX-POLICY",
      options: [],
      prompt: "Quais regras devem ser aplicadas às despesas de alimentação?",
      rationale: "A política ainda não foi cadastrada.",
      required: true,
      type: "TEXT",
    }],
    needsContext: true,
  }) as { contextQuestions: unknown[]; needsContext: boolean };

  assert.deepEqual(normalized.contextQuestions, []);
  assert.equal(normalized.needsContext, false);
});

test("converte seleção com opções opacas em resposta de texto", () => {
  const normalized = normalizeAuditContent({
    contextQuestions: [{
      code: "CTX-VEHICLE",
      options: [
        { label: "All Violet", value: "all-violet" },
        { label: "All Filet", value: "all-filet" },
      ],
      prompt: "Qual placa aparece no controle de abastecimento?",
      rationale: "A placa identifica o veículo.",
      required: true,
      type: "SINGLE_SELECT",
    }],
    needsContext: true,
  }) as { contextQuestions: Array<{ options: unknown[]; type: string }> };

  assert.equal(normalized.contextQuestions[0]?.type, "TEXT");
  assert.deepEqual(normalized.contextQuestions[0]?.options, []);
});

test("permite uma rota de contingência explícita após 503 retryable", async () => {
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

test("permite uma rota de contingência explícita após timeout", async () => {
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

test("repete o mesmo avaliador uma vez quando a resposta estruturada é inválida", async () => {
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

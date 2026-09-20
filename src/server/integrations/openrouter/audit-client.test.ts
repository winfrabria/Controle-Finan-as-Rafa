import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_POLICY,
  FAST_EXTRACTION_MODEL,
  FAST_EXTRACTION_REVIEW_MODEL,
  HARNESS_FALLBACK_MODEL,
  HARNESS_MODEL,
  HARNESS_PDF_MODEL,
} from "@/lib/audit-harness";
import {
  normalizeAuditContent,
  OpenRouterAuditDiscoveryClient,
  OpenRouterAuditDiscoveryError,
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

test("resposta vazia preserva custo e ID da geração sem armazenar raciocínio", async () => {
  const client = new OpenRouterAuditDiscoveryClient({ apiKey: "test-only", appUrl: undefined, model: HARNESS_MODEL,
    maxAttempts: 1, timeoutMs: 1000, pdfEngine: "native", fetchImplementation: async () => new Response(JSON.stringify({
      id: "gen-synthetic-empty", model: HARNESS_MODEL, choices: [{ finish_reason: "length", message: {
        content: null, reasoning: "PRIVATE_REASONING_MUST_NOT_BE_STORED" } }],
      usage: { prompt_tokens: 10, completion_tokens: 90, total_tokens: 100, cost: 0.012 },
    }), { status: 200 }) });
  await assert.rejects(client.discover(discoveryRequest), (error: unknown) => {
    assert(error instanceof OpenRouterAuditDiscoveryError);
    assert.equal(error.generationId, "gen-synthetic-empty");assert.equal(error.usage?.costUsd, 0.012);
    assert.equal(error.attemptTrace[0].usage?.costUsd, 0.012);
    assert.equal(error.attemptTrace[0].generationId, "gen-synthetic-empty");
    assert.doesNotMatch(JSON.stringify(error.attemptTrace), /PRIVATE_REASONING/);
    return true;
  });
});

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

test("configura auditoria Terra high com recuperação distinta no Sol high", () => {
  const config = getOpenRouterConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-only",
    OPENROUTER_MAX_ATTEMPTS: "5",
  });

  assert.equal(config.model, HARNESS_MODEL);
  assert.equal(config.maxAttempts, 2);
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.fallbackModel, HARNESS_FALLBACK_MODEL);
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
  assert.equal(config.fallbackModel, HARNESS_FALLBACK_MODEL);
});

test("configura Gemini high também para extração e leitura de PDF", () => {
  const config = getOpenRouterConfig(
    {
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-only",
      OPENROUTER_EXTRACTION_MODEL: "google/gemini-3.7-flash",
      OPENROUTER_EXTRACTION_REASONING_EFFORT: "high",
      OPENROUTER_PDF_MODEL: "google/gemini-3.7-flash",
      OPENROUTER_PDF_REASONING_EFFORT: "high",
    },
    "extraction",
  );

  assert.equal(config.model, "google/gemini-3.7-flash");
  assert.equal(config.pdfModel, "google/gemini-3.7-flash");
  assert.equal(config.pdfFallbackModel, HARNESS_FALLBACK_MODEL);
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
  assert.equal(config.maxTokens, 16_384);
});

test("pipeline adaptativo prioriza extrator rápido e revisão visual distinta", () => {
  const config = getOpenRouterConfig(
    {
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-only",
      OPENROUTER_EXTRACTION_PIPELINE: "adaptive",
    },
    "extraction",
  );

  assert.equal(config.model, FAST_EXTRACTION_MODEL);
  assert.equal(config.pdfModel, FAST_EXTRACTION_MODEL);
  assert.equal(config.fallbackModel, FAST_EXTRACTION_REVIEW_MODEL);
  assert.equal(config.pdfFallbackModel, FAST_EXTRACTION_REVIEW_MODEL);
  assert.equal(config.pdfEngine, "native");
  assert.equal(config.pdfFallbackEngine, "native");
  assert.equal(config.extractionQualityGateEnabled, true);
  assert.equal(config.providerSort, "throughput");
  assert.equal(config.reasoningEffort, "low");
  assert.equal(config.pdfReasoningEffort, "low");
  assert.equal(config.extractionFallbackReasoningEffort, "high");
  assert.equal(config.timeoutMs, 60_000);
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
  assert.equal(payload?.max_completion_tokens, 8_192);
  assert.equal("max_tokens" in (payload ?? {}), false);
  assert.deepEqual(payload?.provider, {
    require_parameters: true,
    sort: "latency",
    zdr: true,
  });
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

test("descarta também pergunta de política equivalente em inglês", () => {
  const normalized = normalizeAuditContent({
    contextQuestions: [{
      code: "CTX-POLICY-EN",
      options: [],
      prompt: "Which policies should be applied to meal expenses?",
      rationale: "The policy is not present in the document.",
      required: true,
      type: "TEXT",
    }],
    needsContext: true,
  }) as { contextQuestions: unknown[]; needsContext: boolean };

  assert.deepEqual(normalized.contextQuestions, []);
  assert.equal(normalized.needsContext, false);
});

test("descarta pergunta da IA que solicita segredo, credencial ou dado bancário", () => {
  for (const prompt of [
    "Informe sua senha para confirmar a despesa.",
    "Qual é o código de autenticação recebido por SMS?",
    "Digite o número do cartão e o CVV.",
    "What is the API key used by this integration?",
    "Informe a chave PIX do beneficiário.",
  ]) {
    const normalized = normalizeAuditContent({
      contextQuestions: [{
        code: "CTX-SENSITIVE",
        options: [],
        prompt,
        rationale: "A resposta seria usada para concluir a análise.",
        required: true,
        type: "TEXT",
      }],
      needsContext: true,
    }) as { contextQuestions: unknown[]; needsContext: boolean };

    assert.deepEqual(normalized.contextQuestions, [], prompt);
    assert.equal(normalized.needsContext, false, prompt);
  }
});

test("converte seleção com opções opacas em resposta de texto", () => {
  const normalized = normalizeAuditContent({
    contextQuestions: [{
      code: "CTX-VEHICLE",
      options: [
        { label: "Unknown option A", value: "unknown-a" },
        { label: "Unknown option B", value: "unknown-b" },
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

test("deduplica opções também pelo valor antes da validação estrutural", () => {
  const normalized = normalizeAuditContent({
    contextQuestions: [{
      code: "CTX-SYNTHETIC",
      options: [
        { label: "Primeira opção", value: "same-value" },
        { label: "Segunda opção", value: "same-value" },
      ],
      prompt: "Qual alternativa consta no controle externo?",
      rationale: "A alternativa depende de um cadastro externo.",
      required: true,
      type: "SINGLE_SELECT",
    }],
    needsContext: true,
  }) as { contextQuestions: Array<{ options: unknown[]; type: string }> };

  assert.equal(normalized.contextQuestions[0]?.type, "TEXT");
  assert.deepEqual(normalized.contextQuestions[0]?.options, []);
});

test("preserva needsContext declarado sem fabricar perguntas", () => {
  const normalized = normalizeAuditContent({
    contextQuestions: [],
    needsContext: true,
    summary: "Ainda falta um dado externo, mas a rodada pública já foi usada.",
  }) as { contextQuestions: unknown[]; needsContext: boolean };

  assert.deepEqual(normalized.contextQuestions, []);
  assert.equal(normalized.needsContext, true);
});

test("não troca de modelo após indisponibilidade HTTP 503", async () => {
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

      return new Response(
        JSON.stringify({
          error: {
            message: "secret-provider-detail-must-not-escape",
            metadata: { raw: "internal-reasoning-must-not-escape" },
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    client.discover(discoveryRequest),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(JSON.stringify(error).includes("must-not-escape"), false);
      return true;
    },
  );
  assert.deepEqual(requestedModels, [HARNESS_MODEL]);
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

test("usa Sol uma vez quando a resposta estruturada do Terra é inválida", async () => {
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
        : successfulAuditResponse(AUDIT_POLICY.fallbackModel);
    },
  });

  const result = await client.discover(discoveryRequest);
  assert.deepEqual(requestedModels, [HARNESS_MODEL, AUDIT_POLICY.fallbackModel]);
  assert.equal(result.attempts, 2);
  assert.deepEqual(
    result.attemptTrace.map((attempt) => attempt.kind),
    ["invalid-response", "success"],
  );
});

test("resposta inválida com uso explicitamente zerado repete o mesmo modelo antes do fallback", async () => {
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
      if (requestedModels.length > 1) return successfulAuditResponse(HARNESS_MODEL);
      return new Response(JSON.stringify({
        id: "gen-zero-cost-invalid",
        model: HARNESS_MODEL,
        provider: "test",
        choices: [{ message: { content: "not-json" } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await client.discover(discoveryRequest);
  assert.deepEqual(requestedModels, [HARNESS_MODEL, HARNESS_MODEL]);
  assert.equal(result.model, HARNESS_MODEL);
  assert.equal(result.attempts, 2);
  assert.equal(result.attemptTrace[0]?.usage?.costUsd, 0);
});

for (const status of [402, 429, 503]) {
  test(`envelope HTTP 200 da auditoria com código ${status} não abre fallback`, async () => {
    let calls = 0;
    const client = new OpenRouterAuditDiscoveryClient({
      apiKey: "test-only",
      appUrl: undefined,
      fallbackModel: AUDIT_POLICY.fallbackModel,
      model: HARNESS_MODEL,
      maxAttempts: 2,
      pdfEngine: "native",
      timeoutMs: 1_000,
      sleep: async () => undefined,
      fetchImplementation: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: status,
              message: `Provider returned HTTP ${status}.`,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await assert.rejects(
      client.discover(discoveryRequest),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { status?: number }).status, status);
        assert.equal((error as { attempts?: number }).attempts, 1);
        return true;
      },
    );
    assert.equal(calls, 1);
  });
}

test("HTTP 400 da auditoria registra metadados seguros e aciona o Sol", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string>> = [];
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: HARNESS_FALLBACK_MODEL,
    model: HARNESS_MODEL,
    maxAttempts: 2,
    pdfEngine: "native",
    timeoutMs: 1_000,
    sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      headers.push(init?.headers as Record<string, string>);
      if (payloads.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: "PROVIDER_BAD_REQUEST",
              message: "unsupported parameter; token=must-not-escape",
              metadata: {
                provider_name: "OpenAI",
                request_id: "route-request-audit",
                route: "openai-primary",
                raw: "internal-data-must-not-escape",
              },
            },
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "x-openrouter-request-id": "openrouter-request-audit",
            },
          },
        );
      }
      return successfulAuditResponse(HARNESS_FALLBACK_MODEL);
    },
  });

  const result = await client.discover(discoveryRequest);

  assert.deepEqual(
    payloads.map((payload) => payload.model),
    [HARNESS_MODEL, HARNESS_FALLBACK_MODEL],
  );
  assert.deepEqual(payloads[0]?.provider, {
    require_parameters: true,
    sort: "latency",
    zdr: true,
  });
  assert.deepEqual(payloads[1]?.provider, {
    require_parameters: true,
    sort: "latency",
    zdr: true,
  });
  assert.equal(headers[0]?.["X-OpenRouter-Metadata"], "enabled");
  assert.equal(headers[1]?.["X-OpenRouter-Metadata"], "enabled");
  assert.deepEqual(result.attemptTrace[0], {
    attempt: 1,
    detail: "provider-configuration-rejected",
    kind: "provider",
    latencyMs: result.attemptTrace[0]?.latencyMs,
    model: HARNESS_MODEL,
    provider: "OpenAI",
    requestId: "openrouter-request-audit",
    routingMetadata: {
      provider_name: "OpenAI",
      request_id: "route-request-audit",
      route: "openai-primary",
    },
    status: 400,
  });
  assert.equal(JSON.stringify(result.attemptTrace).includes("must-not-escape"), false);
});

test("HTTP 404 sem endpoint elegível aciona Sol high e usa o parâmetro compatível", async () => {
  const requestedModels: string[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: HARNESS_FALLBACK_MODEL,
    model: HARNESS_MODEL,
    maxAttempts: 5,
    pdfEngine: "native",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      requestedModels.push(String(payload.model));
      if (requestedModels.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: "No eligible endpoints found for the requested model parameters.",
              metadata: {
                provider_name: "Azure",
                route: "openai-zdr",
                raw: "internal-data-must-not-escape",
              },
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return successfulAuditResponse(HARNESS_FALLBACK_MODEL);
    },
  });

  const result = await client.discover(discoveryRequest);

  assert.deepEqual(requestedModels, [HARNESS_MODEL, HARNESS_FALLBACK_MODEL]);
  assert.equal(payloads[0]?.max_completion_tokens, 8_192);
  assert.equal(payloads[1]?.max_completion_tokens, 8_192);
  assert.equal(result.attempts, 2);
  assert.equal(result.model, HARNESS_FALLBACK_MODEL);
  assert.equal(result.attemptTrace[0]?.status, 404);
  assert.equal(result.attemptTrace[0]?.detail, "provider-endpoint-unavailable");
  assert.equal(JSON.stringify(result.attemptTrace).includes("must-not-escape"), false);
});

test("HTTP 404 arbitrário da auditoria não abre fallback", async () => {
  let calls = 0;
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: HARNESS_FALLBACK_MODEL,
    model: HARNESS_MODEL,
    maxAttempts: 5,
    pdfEngine: "native",
    sleep: async () => undefined,
    timeoutMs: 1_000,
    fetchImplementation: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: { code: 404, message: "The requested audit record was not found." },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    client.discover(discoveryRequest),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      (error as { status?: number }).status === 404 &&
      "attempts" in error &&
      (error as { attempts?: number }).attempts === 1,
  );
  assert.equal(calls, 1);
});

test("404 de endpoint no Sol termina após uma única recuperação", async () => {
  const requestedModels: string[] = [];
  const client = new OpenRouterAuditDiscoveryClient({
    apiKey: "test-only",
    appUrl: undefined,
    fallbackModel: HARNESS_FALLBACK_MODEL,
    model: HARNESS_MODEL,
    maxAttempts: 5,
    pdfEngine: "native",
    sleep: async () => undefined,
    timeoutMs: 1_000,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(payload.model);
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message: "No eligible endpoints found for the requested model parameters.",
          },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    client.discover(discoveryRequest),
    (error: unknown) =>
      error instanceof Error &&
      "attempts" in error &&
      (error as { attempts?: number }).attempts === 2,
  );
  assert.deepEqual(requestedModels, [HARNESS_MODEL, HARNESS_FALLBACK_MODEL]);
});

for (const status of [402, 429, 503]) {
  test(`HTTP ${status} da auditoria não abre fallback pago`, async () => {
    let calls = 0;
    const client = new OpenRouterAuditDiscoveryClient({
      apiKey: "test-only",
      appUrl: undefined,
      fallbackModel: HARNESS_FALLBACK_MODEL,
      model: HARNESS_MODEL,
      maxAttempts: 5,
      pdfEngine: "native",
      sleep: async () => undefined,
      timeoutMs: 1_000,
      fetchImplementation: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ error: { message: "Provider unavailable." } }),
          { status, headers: { "content-type": "application/json" } },
        );
      },
    });

    await assert.rejects(() => client.discover(discoveryRequest));
    assert.equal(calls, 1);
  });
}

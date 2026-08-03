import assert from "node:assert/strict";
import test from "node:test";

import { HARNESS_MODEL } from "@/lib/audit-harness";
import { OpenRouterAuditDiscoveryClient } from "./audit-client";

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
      return new Response(JSON.stringify({
        model: HARNESS_MODEL,
        provider: "test",
        choices: [{ message: { content: JSON.stringify({
        findings: [],
        coverage: { sufficientEvidence: true, checkedAreas: ["FREE_DISCOVERY"], limitations: [] },
        contextQuestions: [],
        needsContext: false,
        summary: "Sem achados adicionais.",
        }), reasoning: "must-not-be-read" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await client.discover({
    invoice: {
      documentNumber: "1", supplierName: "Fornecedor", supplierTaxId: null,
      issuedAt: "2026-07-10", totalAmount: "10.00", readConfidence: 0.9,
      warnings: [], markdown: "Cupom fiscal", items: [],
    },
    deterministicFindings: [],
    workRules: [],
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

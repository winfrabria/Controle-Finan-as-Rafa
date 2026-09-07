import assert from "node:assert/strict";
import test from "node:test";
import { getOpenRouterConfig } from "./config";
import { effectiveRunReasoning, extractionReasoningStorage } from "@/lib/integrations/openrouter/extraction-reasoning";

test("extração aceita esforços econômicos sem relaxar a política da auditoria", () => {
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "offline-key", OPENROUTER_EXTRACTION_PIPELINE: "adaptive",
      OPENROUTER_EXTRACTION_REASONING_EFFORT: effort, OPENROUTER_PDF_REASONING_EFFORT: effort };
    const config = getOpenRouterConfig(env, "extraction");
    assert.equal(config.reasoningEffort, effort);
    assert.equal(config.pdfReasoningEffort, effort);
    assert.equal(getOpenRouterConfig(env, "audit").reasoningEffort, "high");
  }
  assert.throws(() => getOpenRouterConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "offline-key", OPENROUTER_AUDIT_REASONING_EFFORT: "low" }, "audit"));
});

test("configuração inválida identifica o campo certo antes de enviar documento", () => {
  for (const name of ["OPENROUTER_EXTRACTION_REASONING_EFFORT", "OPENROUTER_PDF_REASONING_EFFORT", "OPENROUTER_EXTRACTION_FALLBACK_REASONING_EFFORT"]) {
    assert.throws(() => getOpenRouterConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "offline-key", [name]: "broken" }, "extraction"), new RegExp(name));
  }
});

test("logs usam o esforço real da extração e preservam auditoria e registros antigos", () => {
  assert.equal(extractionReasoningStorage("low"), "HIGH");
  assert.equal(effectiveRunReasoning({ kind: "EXTRACTION", reasoningEffort: "HIGH", structuredResponse: { extractionReasoningEffort: "low" } }), "LOW");
  assert.equal(effectiveRunReasoning({ kind: "AUDIT", reasoningEffort: "HIGH", structuredResponse: { extractionReasoningEffort: "low" } }), "HIGH");
  assert.equal(effectiveRunReasoning({ kind: "EXTRACTION", reasoningEffort: "XHIGH" }), "XHIGH");
  assert.equal(effectiveRunReasoning({ kind: "EXTRACTION", reasoningEffort: "HIGH", structuredResponse: { extractionReasoningEffort: "unsafe value" } }), "HIGH");
});

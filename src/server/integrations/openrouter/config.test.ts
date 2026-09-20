import assert from "node:assert/strict";
import test from "node:test";
import { getOpenRouterConfig, selectDocumentExtractionConfig } from "./config";
import { createConfiguredInvoiceExtractionClient, type OpenRouterClientOptions } from "./client";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { resolveVerificationOutputTokenParameter } from "./routing";

test("verificador usa PDF nativo sem trocar modelo, esforço ou prazo", () => {
  const config = getOpenRouterConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic" }, "verification");
  assert.equal(config.pdfEngine, "native"); assert.equal(config.model, "openai/gpt-5.6-sol");
  assert.equal(config.reasoningEffort, "high"); assert.equal(config.timeoutMs, 120_000); assert.equal(config.maxAttempts, 1);
});

test("verificação longa admite teto explícito maior sem ampliar descoberta ou extração", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic", OPENROUTER_VERIFIER_MAX_TOKENS: "32768" };
  assert.equal(getOpenRouterConfig(env, "verification").maxTokens, 32768);
  assert.equal(getOpenRouterConfig(env, "audit").maxTokens, 8192);
  assert.equal(getOpenRouterConfig(env, "extraction").maxTokens, 16384);
  assert.throws(() => getOpenRouterConfig({ ...env, OPENROUTER_VERIFIER_MAX_TOKENS: "32769" }, "verification"));
});

test("auditoria em segundo plano aceita prazo maior sem estender a leitura", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic", OPENROUTER_AUDIT_TIMEOUT_MS: "180000",
    OPENROUTER_VERIFIER_TIMEOUT_MS: "180000", OPENROUTER_EXTRACTION_TIMEOUT_MS: "60000" };
  assert.equal(getOpenRouterConfig(env, "audit").timeoutMs, 180000);
  assert.equal(getOpenRouterConfig(env, "verification").timeoutMs, 180000);
  assert.equal(getOpenRouterConfig(env, "extraction").timeoutMs, 60000);
  assert.throws(() => getOpenRouterConfig({ ...env, OPENROUTER_AUDIT_TIMEOUT_MS: "999999" }, "audit"));
  assert.equal(getOpenRouterConfig({ ...env, OPENROUTER_VERIFIER_TIMEOUT_MS: "420000" }, "verification").timeoutMs, 420000);
  assert.throws(() => getOpenRouterConfig({ ...env, OPENROUTER_VERIFIER_TIMEOUT_MS: "600001" }, "verification"));
});

test("engine específico da verificação não altera extração; escolha global explícita é respeitada", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic", OPENROUTER_PDF_ENGINE: "mistral-ocr" };
  assert.equal(getOpenRouterConfig(env, "verification").pdfEngine, "mistral-ocr");
  assert.equal(getOpenRouterConfig({ ...env, OPENROUTER_VERIFIER_PDF_ENGINE: "native" }, "verification").pdfEngine, "native");
  assert.equal(getOpenRouterConfig({ ...env, OPENROUTER_VERIFIER_PDF_ENGINE: "native" }, "extraction").pdfEngine, "mistral-ocr");
  assert.throws(() => getOpenRouterConfig({ ...env, OPENROUTER_VERIFIER_PDF_ENGINE: "unknown" }, "verification"), /OPENROUTER_VERIFIER_PDF_ENGINE/);
});

test("padrões de extração legada e adaptativa permanecem separados", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic" };
  assert.equal(getOpenRouterConfig(env, "extraction").pdfEngine, "mistral-ocr");
  assert.equal(getOpenRouterConfig({ ...env, OPENROUTER_EXTRACTION_PIPELINE: "adaptive" }, "extraction").pdfEngine, "native");
});

test("dialeto experimental de tokens fica restrito ao probe, sem configuração no runtime", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic" };
  assert.equal(resolveVerificationOutputTokenParameter(), "max_completion_tokens");
  assert.equal(resolveVerificationOutputTokenParameter("max_tokens"), "max_tokens");
  const override = { ...env, HARNESS_PROBE_TOKEN_PARAMETER: "max_tokens" };
  for (const workload of ["audit", "extraction", "verification"] as const) {
    assert.equal(Object.hasOwn(getOpenRouterConfig(override, workload), "outputTokenParameter"), false);
  }
  assert.throws(() => resolveVerificationOutputTokenParameter("unknown"), /HARNESS_PROBE_TOKEN_PARAMETER/);
});

const largeReaderEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic",
  OPENROUTER_EXTRACTION_PIPELINE: "adaptive", OPENROUTER_LARGE_PDF_READER: "gemini-3.7-low" };

test("leitor de PDF longo é opt-in validado e não muda auditoria/verificação", () => {
  const off = getOpenRouterConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic" }, "extraction");
  assert.equal(off.largePdfReader, "off");
  assert.strictEqual(selectDocumentExtractionConfig(off, { mimeType: "application/pdf", pageCount: 23 }), off);
  assert.throws(() => getOpenRouterConfig({ ...largeReaderEnvironment, OPENROUTER_LARGE_PDF_READER: "arbitrary" }, "extraction"), /OPENROUTER_LARGE_PDF_READER/);
  assert.throws(() => getOpenRouterConfig({ ...largeReaderEnvironment, OPENROUTER_EXTRACTION_PIPELINE: "legacy" }, "extraction"), /requires adaptive/);
  for (const workload of ["audit", "verification"] as const) assert.equal(getOpenRouterConfig(largeReaderEnvironment, workload).largePdfReader, "off");
});

test("PDF longo conhecido usa perfil limitado, sem mudar imagens, documentos curtos ou consolidação", () => {
  const config = getOpenRouterConfig(largeReaderEnvironment, "extraction");
  const selected = selectDocumentExtractionConfig(config, { mimeType: "application/pdf", pageCount: 10 });
  assert.equal(selected.pdfModel, "google/gemini-3.7-flash"); assert.equal(selected.pdfReasoningEffort, "low");
  assert.equal(selected.maxAttempts, 1); assert.equal(selected.maxTokens, 32768);
  assert.equal(selected.timeoutMs, 120000); assert.equal(selected.totalTimeoutMs, 120000);
  assert.equal(selected.extractionQualityGateEnabled, true);
  assert.equal(config.pdfModel, "google/gemini-3.1-flash-lite");
  for (const input of [
    { mimeType: "application/pdf", pageCount: 9 }, { mimeType: "application/pdf", pageCount: null },
    { mimeType: "application/pdf", pageCount: 10.5 }, { mimeType: "image/png", pageCount: 23 },
    { mimeType: "application/pdf", pageCount: 23, visualWindows: [] },
  ]) assert.strictEqual(selectDocumentExtractionConfig(config, input), config);
});

test("cliente configurado despacha cada documento para o perfil certo sem iniciar chamadas extras", async () => {
  const configured = getOpenRouterConfig(largeReaderEnvironment, "extraction"), choices: OpenRouterClientOptions[] = [];
  const data = invoiceExtractionSchema.parse({ markdown: "Fixture", readConfidence: 0.9, items: [] });
  const client = createConfiguredInvoiceExtractionClient(configured, options => ({ extractInvoice: async () => {
    choices.push(options); return { attempts: 1, latencyMs: 1, model: options.pdfModel!, data };
  } }));
  const request = { fileName: "synthetic.pdf", mimeType: "application/pdf" as const, signedUrl: "https://storage.test/synthetic.pdf" };
  await client.extractInvoice({ ...request, pageCount: 10 });
  await client.extractInvoice({ ...request, pageCount: 3 });
  assert.deepEqual(choices.map(choice => choice.pdfModel), ["google/gemini-3.7-flash", "google/gemini-3.1-flash-lite"]);
  assert.equal(choices[0].maxAttempts, 1); assert.equal(choices.length, 2);
});

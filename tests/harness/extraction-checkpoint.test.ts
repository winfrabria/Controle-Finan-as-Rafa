import assert from "node:assert/strict";
import test from "node:test";
import { extractionCheckpointFingerprint, safePersistenceDiagnostic } from "@/server/notes/extraction-checkpoint";
import { getOpenRouterConfig } from "@/server/integrations/openrouter/config";

test("checkpoint liga fonte imutável e política de leitura, sem depender de credencial ou versão da nota", () => {
  const config = getOpenRouterConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic", OPENROUTER_EXTRACTION_PIPELINE: "adaptive" }, "extraction");
  const source = { id: "synthetic", originalFileSha256: "a".repeat(64), originalMimeType: "application/pdf", originalPageCount: 2, claimedVersion: 1 };
  const fingerprint = extractionCheckpointFingerprint(source, config);
  assert.equal(extractionCheckpointFingerprint({ ...source, claimedVersion: 3 }, { ...config, apiKey: "other" }), fingerprint);
  for (const changed of [ { ...source, id: "other" }, { ...source, originalFileSha256: "b".repeat(64) },
    { ...source, originalPageCount: 3 }, { ...source, originalMimeType: "image/png" } ]) {
    assert.notEqual(extractionCheckpointFingerprint(changed, config), fingerprint);
  }
  assert.notEqual(extractionCheckpointFingerprint(source, { ...config, model: "openai/gpt-5.6-luna" }), fingerprint);
  assert.notEqual(extractionCheckpointFingerprint(source, { ...config, largePdfReader: "gemini-3.7-low" }), fingerprint);
  const unhashed = { ...source, originalFileSha256: null };
  assert.notEqual(extractionCheckpointFingerprint(unhashed, config), extractionCheckpointFingerprint({ ...unhashed, claimedVersion: 2 }, config));
});

test("diagnóstico de persistência nunca registra mensagem, SQL ou URL", () => {
  const error = Object.assign(new Error("sensitive query https://secret.invalid"), { code: "P2028" });
  assert.deepEqual(safePersistenceDiagnostic(error), { errorType: "Error", code: "P2028" });
  assert.deepEqual(safePersistenceDiagnostic({ code: "secret.invalid" }), { errorType: "PersistenceError", code: null });
});

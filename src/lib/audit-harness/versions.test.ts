import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_MODEL,
  HARNESS_PDF_MODEL,
  resolveAuditEvaluatorModel,
  resolveAuditReasoningEffort,
  resolveHarnessModel,
  resolvePdfModel,
} from "./versions";

test("Terra é o modelo padrão de auditoria e PDF", () => {
  assert.equal(HARNESS_MODEL, "openai/gpt-5.6-terra");
  assert.equal(HARNESS_PDF_MODEL, "openai/gpt-5.6-terra");
  assert.equal(resolveHarnessModel(undefined), HARNESS_MODEL);
  assert.equal(resolvePdfModel(undefined), HARNESS_PDF_MODEL);
});

test("configurações legadas de Luna e Sol não desviam novos anexos", () => {
  assert.equal(resolveHarnessModel("openai/gpt-5.6-luna"), HARNESS_MODEL);
  assert.equal(resolvePdfModel("openai/gpt-5.6-luna"), HARNESS_PDF_MODEL);
  assert.equal(resolveHarnessModel("openai/gpt-5.6-sol"), HARNESS_MODEL);
  assert.equal(resolvePdfModel("openai/gpt-5.6-sol"), HARNESS_PDF_MODEL);
});

test("modelos explicitamente diferentes continuam configuráveis", () => {
  assert.equal(resolveHarnessModel("openai/gpt-5.5"), "openai/gpt-5.5");
  assert.equal(resolvePdfModel("openai/gpt-5.5"), "openai/gpt-5.5");
});

test("troca o avaliador somente pela variável experimental explícita", () => {
  assert.equal(resolveAuditEvaluatorModel(undefined), HARNESS_MODEL);
  assert.equal(
    resolveAuditEvaluatorModel("google/gemini-3.6-flash"),
    "google/gemini-3.6-flash",
  );
  assert.equal(resolveAuditReasoningEffort("high"), "high");
  assert.equal(resolveAuditReasoningEffort("max"), "max");
  assert.throws(() => resolveAuditEvaluatorModel("modelo/desconhecido"));
  assert.throws(() => resolveAuditReasoningEffort("medium"));
});

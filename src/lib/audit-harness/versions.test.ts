import assert from "node:assert/strict";
import test from "node:test";

import {
  FAST_EXTRACTION_MODEL,
  FAST_EXTRACTION_REVIEW_MODEL,
  HARNESS_MODEL,
  HARNESS_PDF_MODEL,
  resolveAuditEvaluatorModel,
  resolveAuditReasoningEffort,
  resolveExtractionFallbackModel,
  resolveExtractionModel,
  resolveExtractionPipelineMode,
  resolveHarnessModel,
  resolveHarnessVerifierMode,
  resolveHarnessVerifierModel,
  resolveHarnessVerifierReasoningEffort,
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
    resolveAuditEvaluatorModel("google/gemini-3.7-flash"),
    "google/gemini-3.7-flash",
  );
  assert.equal(
    resolveAuditEvaluatorModel("google/gemini-3.6-flash"),
    "google/gemini-3.6-flash",
  );
  assert.equal(resolveAuditReasoningEffort("high"), "high");
  assert.equal(resolveAuditReasoningEffort("max"), "max");
  assert.throws(() => resolveAuditEvaluatorModel("modelo/desconhecido"));
  assert.throws(() => resolveAuditReasoningEffort("medium"));
});

test("pipeline adaptativo separa extração rápida, revisão visual e auditoria", () => {
  assert.equal(resolveExtractionPipelineMode(undefined), "legacy");
  assert.equal(resolveExtractionPipelineMode("adaptive"), "adaptive");
  assert.equal(
    resolveExtractionModel(undefined, "adaptive"),
    FAST_EXTRACTION_MODEL,
  );
  assert.equal(
    resolveExtractionModel(undefined, "adaptive", "pdf"),
    FAST_EXTRACTION_MODEL,
  );
  assert.equal(
    resolveExtractionFallbackModel(undefined, "adaptive"),
    FAST_EXTRACTION_REVIEW_MODEL,
  );
  assert.throws(() => resolveExtractionPipelineMode("experimental"));
  assert.throws(() =>
    resolveExtractionModel("modelo/sem-contrato", "adaptive"),
  );
});

test("verificador fica off por padrão e enforce exige gate humano", () => {
  assert.equal(resolveHarnessVerifierMode(undefined, undefined), "off");
  assert.equal(resolveHarnessVerifierMode("shadow", undefined), "shadow");
  assert.throws(
    () => resolveHarnessVerifierMode("enforce", "false"),
    /GATE_APPROVED=true/,
  );
  assert.equal(resolveHarnessVerifierMode("enforce", "true"), "enforce");
  assert.equal(resolveHarnessVerifierModel(undefined), "openai/gpt-5.6-sol");
  assert.throws(() => resolveHarnessVerifierModel("openai/gpt-5.6-terra"));
  assert.equal(resolveHarnessVerifierReasoningEffort(undefined), "high");
  assert.throws(() => resolveHarnessVerifierReasoningEffort("xhigh"));
});

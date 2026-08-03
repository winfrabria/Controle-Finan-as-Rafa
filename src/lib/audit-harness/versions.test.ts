import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_MODEL,
  HARNESS_PDF_MODEL,
  resolveHarnessModel,
  resolvePdfModel,
} from "./versions";

test("Luna é o modelo padrão de auditoria e PDF", () => {
  assert.equal(HARNESS_MODEL, "openai/gpt-5.6-luna");
  assert.equal(HARNESS_PDF_MODEL, "openai/gpt-5.6-luna");
  assert.equal(resolveHarnessModel(undefined), HARNESS_MODEL);
  assert.equal(resolvePdfModel(undefined), HARNESS_PDF_MODEL);
});

test("configuração legada do Sol não roteia novos anexos para outro modelo", () => {
  assert.equal(resolveHarnessModel("openai/gpt-5.6-sol"), HARNESS_MODEL);
  assert.equal(resolvePdfModel("openai/gpt-5.6-sol"), HARNESS_PDF_MODEL);
});

test("modelos explicitamente diferentes continuam configuráveis", () => {
  assert.equal(resolveHarnessModel("openai/gpt-5.5"), "openai/gpt-5.5");
  assert.equal(resolvePdfModel("openai/gpt-5.5"), "openai/gpt-5.5");
});

import assert from "node:assert/strict";
import test from "node:test";
import { matchesGenerationModel } from "./generation-metadata";

test("metadado aceita somente o modelo exato ou snapshot datado válido do mesmo alias OpenAI", () => {
  const model = "openai/gpt-5.6-sol";
  assert.equal(matchesGenerationModel(model, model), true);
  assert.equal(matchesGenerationModel(`${model}-20260709`, model), true);
  assert.equal(matchesGenerationModel(`${model}-2026-07-09`, model), true);
  for (const actual of [`${model}-pro`, `${model}-20260230`, `${model}-2026-99-01`, `${model}-20260709-extra`, "openai/gpt-5.6-terra-20260709"]) {
    assert.equal(matchesGenerationModel(actual, model), false);
  }
  assert.equal(matchesGenerationModel("other/model-20260709", "other/model"), false);
});

test("snapshot datado Gemini preserva família e variante do alias", () => {
  const model = "google/gemini-3.8-flash";
  assert.equal(matchesGenerationModel(`${model}-20260902`, model), true);
  assert.equal(matchesGenerationModel(`${model}-2026-09-02`, model), true);
  for (const actual of [`${model}-lite-20260902`, `${model}-20260902-extra`, `${model}-20260230`, "google/gemini-3.7-flash-20260902"]) {
    assert.equal(matchesGenerationModel(actual, model), false);
  }
});

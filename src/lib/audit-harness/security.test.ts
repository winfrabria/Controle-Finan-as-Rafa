import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeForPersistence } from "./security";

test("remove segredo, URL assinada e reasoning em qualquer profundidade", () => {
  const sanitized = sanitizeForPersistence({
    safe: true,
    apiKey: "secret",
    nested: { signed_url: "https://signed", reasoning: "private", evidence: "ok" },
    choices: [{ chainOfThought: "private", result: "ok" }],
  });
  assert.deepEqual(sanitized, {
    safe: true,
    nested: { evidence: "ok" },
    choices: [{ result: "ok" }],
  });
});

test("remove segredos e raciocínio embutidos em contextSummary e outros textos livres", () => {
  const sanitized = sanitizeForPersistence({
    contextSummary: [
      "Análise concluída.",
      "api_key=sk-test-only",
      "Authorization: Bearer should-not-persist",
      "reasoning: raciocínio interno não deve persistir",
      "Fonte https://storage.example.test/file?token=signed-secret&download=1",
    ].join("\n"),
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(
    serialized,
    /sk-test-only|should-not-persist|raciocínio interno|signed-secret/,
  );
  assert.match(serialized, /Análise concluída/);
});


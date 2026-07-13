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


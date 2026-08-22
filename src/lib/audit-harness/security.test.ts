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

test("remove credenciais genéricas sem apagar métricas de tokens", () => {
  const sanitized = sanitizeForPersistence({
    token: "token-field",
    access_token: "access-field",
    refreshToken: "refresh-field",
    authToken: "auth-field",
    jwt: "jwt-field",
    csrf_token: "csrf-field",
    nonce: "nonce-field",
    secret: "secret-field",
    client_secret: "client-field",
    password: "password-field",
    cookie: "session=field",
    nested: [{ sessionId: "session-field", safe: "preservado" }],
    promptTokens: 120,
    completionTokens: 30,
    totalTokens: 150,
    text: [
      "token=token-text",
      "secret: secret-text",
      "password=password-text",
      "cookie: cookie-text",
      "Métrica totalTokens=150 permanece apenas como texto comum.",
    ].join("\n"),
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, /token-field|access-field|refresh-field|auth-field|jwt-field|csrf-field|nonce-field|secret-field|client-field|password-field|session=field|session-field|token-text|secret-text|password-text|cookie-text/);
  assert.match(serialized, /preservado/);
  assert.match(serialized, /"promptTokens":120/);
  assert.match(serialized, /"completionTokens":30/);
  assert.match(serialized, /"totalTokens":150/);
});


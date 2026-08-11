import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_DISCOVERY_PROMPT, INVOICE_EXTRACTION_PROMPT } from "./prompts";

test("exige cobertura completa de fichas de reembolso e valores concorrentes", () => {
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /todas as páginas/i);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /valor efetivamente pago/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /checagem de cobertura/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /não repita o mesmo problema/i);
});

test("separa contradição interna de contexto externo", () => {
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /contradição verificável dentro do próprio anexo é um achado/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /diferenças de valor ou data[\s\S]*inconsistências objetivas/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /fato externo à nota/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /quantas pessoas receberam as refeições/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /não use perguntas genéricas/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /nunca peça que ela defina regras/i);
  assert.match(AUDIT_DISCOVERY_PROMPT.system, /"houve desconto\?"[\s\S]*são proibidas/i);
});

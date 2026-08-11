import assert from "node:assert/strict";
import test from "node:test";

import { auditResultLabel, auditResultTone } from "./audit-result-label";

test("auditResult canônico prevalece sobre classification legada", () => {
  assert.equal(auditResultLabel("NEEDS_CONTEXT", "SUSPICIOUS"), "Precisa de informação");
  assert.equal(auditResultLabel("READ_FAILED", "OK"), "Falha de leitura");
  assert.equal(auditResultLabel("OK", "SUSPICIOUS"), "OK");
  assert.equal(auditResultLabel("SUSPICIOUS", "OK"), "Suspeita");
});

test("classification é usada apenas como fallback", () => {
  assert.equal(auditResultLabel(null, "NO_PARAMETER"), "Precisa de informação");
  assert.equal(auditResultLabel(null, "INCOMPATIBLE"), "Falha de leitura");
  assert.equal(auditResultLabel(null, null), "Em análise");
  assert.equal(auditResultTone("Precisa de informação"), "info");
  assert.equal(auditResultTone("Falha de leitura"), "danger");
  assert.equal(auditResultTone("Análise incompleta"), "info");
});

test("status de processamento é usado quando ainda não há resultado de auditoria", () => {
  assert.equal(auditResultLabel(null, null, "FAILED"), "Falha de processamento");
  assert.equal(auditResultLabel(null, null, "READ_FAILED"), "Falha de leitura");
  assert.equal(auditResultTone("Falha de processamento"), "danger");
});

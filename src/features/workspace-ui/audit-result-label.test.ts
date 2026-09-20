import assert from "node:assert/strict";
import test from "node:test";

import { auditResultLabel, auditResultTone } from "./audit-result-label";

test("auditResult canônico prevalece sobre classification legada", () => {
  assert.equal(auditResultLabel("NEEDS_CONTEXT", "SUSPICIOUS"), "Precisa de informação");
  assert.equal(auditResultLabel("READ_FAILED", "OK"), "Falha de leitura");
  assert.equal(auditResultLabel("OK", "SUSPICIOUS"), "OK");
  assert.equal(auditResultLabel("SUSPICIOUS", "OK"), "Suspeita");
  assert.equal(auditResultLabel("OK", "NO_PARAMETER"), "OK");
  assert.equal(auditResultLabel("SUSPICIOUS", "NO_PARAMETER"), "Suspeita");
  assert.equal(auditResultLabel("NEEDS_CONTEXT", "NO_PARAMETER"), "Falha de leitura");
  assert.equal(auditResultLabel("READ_FAILED", "NO_PARAMETER"), "Falha de leitura");
});

test("classification é usada apenas como fallback", () => {
  assert.equal(auditResultLabel(null, "NO_PARAMETER"), "Falha de leitura");
  assert.equal(auditResultLabel(null, "INCOMPATIBLE"), "Falha de leitura");
  assert.equal(auditResultLabel(null, null), "Em análise");
  assert.equal(auditResultTone("Precisa de informação"), "info");
  assert.equal(auditResultTone("Falha de leitura"), "danger");
  assert.equal(auditResultTone("Revisão manual"), "info");
});

test("status de processamento é usado quando ainda não há resultado de auditoria", () => {
  assert.equal(auditResultLabel(null, null, "FAILED"), "Falha de processamento");
  assert.equal(auditResultLabel(null, null, "READ_FAILED"), "Falha de leitura");
  assert.equal(auditResultTone("Falha de processamento"), "danger");
});

test("achado estruturado não aparece como revisão manual", () => {
  assert.equal(
    auditResultLabel("NEEDS_CONTEXT", "NO_PARAMETER", "OK", 1),
    "Suspeita",
  );
  assert.equal(auditResultLabel("OK", "OK", "OK", 1), "Suspeita");
});

test("nota inconclusiva sem achado confirmado não aparece como OK", () => {
  assert.equal(
    auditResultLabel("NEEDS_CONTEXT", "NO_PARAMETER", "OK", 0),
    "Falha de leitura",
  );
});

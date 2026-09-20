import assert from "node:assert/strict";
import test from "node:test";
import { analysisFailureMessage, unavailableDiagnosisCopy } from "./analysis-failure";

test("timeout comunica falha operacional, não ausência de irregularidades", () => {
  assert.match(analysisFailureMessage("FAILED", "EXTRACTION_TIMEOUT")!, /não terminou dentro do prazo/);
  assert.match(analysisFailureMessage("FAILED", "EXTRACTION_TIMEOUT")!, /não uma irregularidade/);
});
test("não vaza código desconhecido nem reutiliza falha em rodada concluída", () => {
  assert.doesNotMatch(analysisFailureMessage("FAILED", "provider-secret")!, /provider-secret/);
  assert.equal(analysisFailureMessage("PROCESSED", "EXTRACTION_TIMEOUT"), null);
  assert.equal(analysisFailureMessage("PROCESSING", null), null);
});

test("revisão manual mostra a causa disponível sem prescrever reprocessamento", () => {
  const reason = "A comparação ficou pendente: cupom 123 não localizado no anexo.";
  for (const status of ["Análise incompleta", "Informação insuficiente", "Revisão manual"]) {
    assert.deepEqual(unavailableDiagnosisCopy(status, reason), {
      title: "Revisão manual necessária", description: reason,
    });
    assert.doesNotMatch(unavailableDiagnosisCopy(status)!.description, /reprocessad|sem evidências estruturadas/);
  }
  for (const status of ["OK", "Suspeita", null]) assert.equal(unavailableDiagnosisCopy(status, reason), null);
  for (const status of ["Em análise", "Aguardando processamento", "Não processado", "Falha de leitura", "Falha de processamento"]) {
    assert.notEqual(unavailableDiagnosisCopy(status, reason)!.description, reason);
  }
});

test("falha de leitura explica cobertura insuficiente sem chamar o anexo de OK", () => {
  const copy = unavailableDiagnosisCopy("Falha de leitura");
  assert.match(copy!.description, /cobertura confiável/);
  assert.match(copy!.description, /arquivo original/);
  assert.doesNotMatch(copy!.description, /OK|aprovad/i);
});

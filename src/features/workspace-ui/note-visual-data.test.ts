import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditResult,
  NoteStatus,
  ProcessingJobStatus,
} from "@/generated/prisma/enums";
import { toNoteVisualItems } from "./note-visual-data";
import { reviewerNotePrimaryReason } from "./reviewer-note-summary";
import { analysisFailureMessage } from "@/features/note-detail/analysis-failure";

const base = {
  activeContextQuestionCount: 0,
  auditResult: null,
  classification: null,
  createdAt: new Date("2026-08-01T12:00:00Z"),
  documentNumber: "1",
  findingCount: 0,
  findings: [],
  id: "note-1",
  isRead: false,
  issuedAt: null,
  primaryFinding: null,
  processingJobStatus: null,
  responsibleName: null,
  readAt: null,
  readBy: null,
  status: "OK" as const,
  supplierName: "Fornecedor",
  totalAmount: "10.00",
  version: 1,
  workName: "Obra",
};

test("falha atual prevalece sobre resultado anterior e não apresenta aprovação", () => {
  const [item] = toNoteVisualItems([{ ...base, status: NoteStatus.FAILED,
    auditResult: AuditResult.OK, primaryFinding: "Achado da rodada anterior" }]);
  assert.equal(item.classification, "Falha de processamento");
  assert.equal(item.processingFailureMessage, analysisFailureMessage("FAILED"));
  assert.equal(reviewerNotePrimaryReason(item, item.classification), "Ainda não há diagnóstico válido desta tentativa");
});

test("lista preserva a explicação segura de timeout e remove-a na reanálise", () => {
  const processingFailureMessage = analysisFailureMessage("FAILED", "VERIFICATION_TIMEOUT");
  const [failed, running] = toNoteVisualItems([
    { ...base, status: NoteStatus.FAILED, processingFailureMessage },
    { ...base, status: NoteStatus.PROCESSING, processingJobStatus: ProcessingJobStatus.RUNNING,
      processingFailureMessage },
  ]);
  assert.equal(failed.processingFailureMessage, processingFailureMessage);
  assert.equal(running.processingFailureMessage, null);
});

test("job interrompido antes da extração também recebe explicação segura", () => {
  for (const processingJobStatus of [ProcessingJobStatus.FAILED, ProcessingJobStatus.CANCELLED]) {
    const [item] = toNoteVisualItems([{ ...base, status: NoteStatus.RECEIVED, processingJobStatus }]);
    assert.equal(item.classification, "Falha de processamento");
    assert.equal(item.processingFailureMessage, analysisFailureMessage("FAILED"));
  }
});

test("resumo móvel diferencia ausência de achado, cobertura incompleta e pergunta pendente", () => {
  const [item] = toNoteVisualItems([base]);
  assert.equal(reviewerNotePrimaryReason(item, "OK"), "Nenhuma inconsistência registrada nesta análise");
  for (const status of ["Informação insuficiente", "Análise incompleta", "Revisão manual"]) {
    assert.equal(reviewerNotePrimaryReason(item, status), "Consulte o motivo da revisão manual");
  }
  assert.equal(reviewerNotePrimaryReason(item, "Precisa de informação"), "Há perguntas pendentes para concluir a análise");
});

test("resumo móvel prioriza um achado real, mas não o apresenta durante reanálise", () => {
  const [item] = toNoteVisualItems([{ ...base, primaryFinding: "Produto divergente" }]);
  assert.equal(reviewerNotePrimaryReason(item, "Suspeita"), "Produto divergente");
  assert.equal(reviewerNotePrimaryReason(item, "Em análise"), "O diagnóstico estará disponível após o processamento");
});

test("prioriza auditResult canônico nos cards", () => {
  const items = toNoteVisualItems([
    { ...base, auditResult: AuditResult.SUSPICIOUS, findingCount: 1 },
    {
      ...base,
      activeContextQuestionCount: 1,
      auditResult: AuditResult.NEEDS_CONTEXT,
      id: "note-2",
    },
    { ...base, auditResult: AuditResult.OK, id: "note-3" },
  ]);

  assert.deepEqual(items.map((item) => item.classification), [
    "Suspeita",
    "Precisa de informação",
    "OK",
  ]);
});

test("resultado legado inconclusivo não é apresentado como OK", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: null, classification: "NO_PARAMETER" },
  ]);

  assert.equal(item.classification, "Falha de leitura");
});

test("resultado legado com achado estruturado aparece como suspeito, não revisão manual", () => {
  const [item] = toNoteVisualItems([
    {
      ...base,
      auditResult: AuditResult.NEEDS_CONTEXT,
      classification: "NO_PARAMETER",
      findingCount: 1,
    },
  ]);

  assert.equal(item.classification, "Suspeita");
});

test("não chama de suspeito um resultado sem achados confirmados", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: AuditResult.SUSPICIOUS, findingCount: 0 },
  ]);

  assert.equal(item.classification, "OK");
});

test("só exibe pedido de informação quando há pergunta ativa", () => {
  const [stale, active] = toNoteVisualItems([
    { ...base, auditResult: AuditResult.NEEDS_CONTEXT },
    {
      ...base,
      activeContextQuestionCount: 2,
      auditResult: AuditResult.NEEDS_CONTEXT,
      id: "note-active-context",
    },
  ]);

  assert.equal(stale.classification, "Falha de leitura");
  assert.equal(active.classification, "Precisa de informação");
});

test("status de leitura insuficiente prevalece sobre campos legados de OK", () => {
  const [item] = toNoteVisualItems([{
    ...base,
    auditResult: AuditResult.NEEDS_CONTEXT,
    classification: "NO_PARAMETER",
    status: NoteStatus.READ_FAILED,
  }]);

  assert.equal(item.classification, "Falha de leitura");
});

test("não apresenta anexo legado sem job como se estivesse processando", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: null, status: "RECEIVED" },
  ]);

  assert.equal(item.classification, "Não processado");
});

test("mostra reanálise em andamento depois do envio de contexto", () => {
  const [item] = toNoteVisualItems([{
    ...base,
    auditResult: AuditResult.NEEDS_CONTEXT,
    id: "note-context-reanalysis",
    processingJobStatus: ProcessingJobStatus.RUNNING,
    status: NoteStatus.PROCESSING,
  }]);

  assert.equal(item.classification, "Em análise");
});

test("exibe a data de recebimento mesmo quando a emissão é de um mês antigo", () => {
  const [item] = toNoteVisualItems([
    {
      ...base,
      createdAt: new Date("2026-08-08T12:00:00Z"),
      issuedAt: new Date("2025-01-15T00:00:00Z"),
    },
  ]);

  assert.equal(item.date, "08/08/2026");
  assert.equal(item.issuedAtLabel, "15/01/2025");
});

test("preserva alcance limitado mesmo quando a nota possui achado suspeito", () => {
  const assurance = { band: "LIMITED" as const, reason: "Verificação independente não concluída." };
  const [item] = toNoteVisualItems([{ ...base, assurance, auditResult: AuditResult.SUSPICIOUS, findingCount: 1 }]);
  assert.equal(item.classification, "Suspeita");
  assert.deepEqual(item.assurance, assurance);
});

test("reanálise não reutiliza o alcance de uma rodada anterior", () => {
  const [item] = toNoteVisualItems([{ ...base, assurance: { band: "HIGH", reason: "Rodada anterior." },
    status: NoteStatus.PROCESSING, processingJobStatus: ProcessingJobStatus.RUNNING }]);
  assert.equal(item.assurance, null);
  assert.equal(item.classification, "Em análise");
});

test("aguardar contexto após concluir o job não apaga a garantia limitada", () => {
  const assurance = { band: "LIMITED" as const, reason: "A leitura ficou incompleta." };
  const [item] = toNoteVisualItems([{ ...base, assurance, status: NoteStatus.PROCESSING,
    auditResult: AuditResult.NEEDS_CONTEXT, activeContextQuestionCount: 1,
    processingJobStatus: ProcessingJobStatus.SUCCEEDED }]);
  assert.deepEqual(item.assurance, assurance);
  assert.equal(item.classification, "Precisa de informação");
  assert.equal(item.issuedAtLabel, undefined);
});

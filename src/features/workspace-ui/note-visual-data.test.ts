import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditResult,
  NoteStatus,
  ProcessingJobStatus,
} from "@/generated/prisma/enums";
import { toNoteVisualItems } from "./note-visual-data";

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

test("normaliza o legado sem parâmetro para informação insuficiente", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: null, classification: "NO_PARAMETER" },
  ]);

  assert.equal(item.classification, "Informação insuficiente");
});

test("não chama de suspeito um resultado sem achados estruturados", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: AuditResult.SUSPICIOUS, findingCount: 0 },
  ]);

  assert.equal(item.classification, "Análise incompleta");
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

  assert.equal(stale.classification, "Análise incompleta");
  assert.equal(active.classification, "Precisa de informação");
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
});

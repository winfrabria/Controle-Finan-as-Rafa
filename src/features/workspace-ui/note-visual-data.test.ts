import assert from "node:assert/strict";
import test from "node:test";

import { AuditResult } from "@/generated/prisma/enums";
import { toNoteVisualItems } from "./note-visual-data";

const base = {
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
  status: "OK" as const,
  supplierName: "Fornecedor",
  totalAmount: "10.00",
  version: 1,
  workName: "Obra",
};

test("prioriza auditResult canônico nos cards", () => {
  const items = toNoteVisualItems([
    { ...base, auditResult: AuditResult.SUSPICIOUS },
    { ...base, auditResult: AuditResult.NEEDS_CONTEXT, id: "note-2" },
    { ...base, auditResult: AuditResult.OK, id: "note-3" },
  ]);

  assert.deepEqual(items.map((item) => item.classification), [
    "Suspeita",
    "Precisa de informação",
    "OK",
  ]);
});

test("normaliza o legado sem parâmetro para precisa de informação", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: null, classification: "NO_PARAMETER" },
  ]);

  assert.equal(item.classification, "Precisa de informação");
});

test("não apresenta anexo legado sem job como se estivesse processando", () => {
  const [item] = toNoteVisualItems([
    { ...base, auditResult: null, status: "RECEIVED" },
  ]);

  assert.equal(item.classification, "Não processado");
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

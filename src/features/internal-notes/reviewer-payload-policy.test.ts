import assert from "node:assert/strict";
import test from "node:test";

import type { NoteListItem } from "./note-list-query";
import {
  sanitizeReviewerDashboardNote,
  sanitizeReviewerNoteListItem,
} from "./reviewer-payload-policy";

const restrictedText =
  "Divergência confirmada. Confiança: 93%. custo da IA: US$ 0,12. " +
  "prompt: instrução secreta. resposta bruta: conteúdo privado. total tokens: 812.";

test("sanitiza achados antes das props do REVIEWER sem mutar a origem", () => {
  const original: NoteListItem = {
    activeContextQuestionCount: 0,
    auditResult: "SUSPICIOUS" as NoteListItem["auditResult"],
    classification: "SUSPICIOUS" as NoteListItem["classification"],
    createdAt: new Date("2026-08-02T12:00:00Z"),
    documentNumber: "123",
    findingCount: 1,
    findings: [
      {
        actualValue: restrictedText,
        category: restrictedText,
        description: restrictedText,
        evidence: restrictedText,
        evidenceDetails: [{ label: "Página", value: restrictedText }],
        expectedValue: restrictedText,
        justification: restrictedText,
        severity: "HIGH",
        title: restrictedText,
      },
    ],
    id: "note-1",
    isRead: false,
    issuedAt: null,
    primaryFinding: restrictedText,
    processingJobStatus: null,
    readAt: null,
    readBy: null,
    responsibleName: "Responsável",
    status: "PENDING_VALIDATION" as NoteListItem["status"],
    supplierName: "Fornecedor",
    totalAmount: "100.00",
    version: 1,
    workName: "Obra",
  };

  const sanitized = sanitizeReviewerNoteListItem(original);
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(
    serialized,
    /93|0,12|instrução secreta|conteúdo privado|812/i,
  );
  assert.match(serialized, /Divergência confirmada/i);
  assert.match(original.findings[0]!.description, /Confiança: 93%/i);
});

test("sanitiza causas do dashboard somente na transformação do REVIEWER", () => {
  const original = {
    classification: "Suspeita" as const,
    date: "02/08/2026",
    dateKey: "2026-08",
    id: "note-1",
    number: "123",
    reasons: [restrictedText],
    responsible: "Responsável",
    supplier: "Fornecedor",
    value: "100.00",
    work: "Obra",
    workId: "work-1",
  };

  const sanitized = sanitizeReviewerDashboardNote(original);

  assert.doesNotMatch(JSON.stringify(sanitized), /93|0,12|812/i);
  assert.match(original.reasons[0]!, /Confiança: 93%/i);
});

test("traduz nomes internos de campos antes de exibir ao REVIEWER", () => {
  const original: NoteListItem = {
    activeContextQuestionCount: 0,
    auditResult: "SUSPICIOUS" as NoteListItem["auditResult"],
    classification: "SUSPICIOUS" as NoteListItem["classification"],
    createdAt: new Date("2026-08-02T12:00:00Z"),
    documentNumber: "123",
    findingCount: 1,
    findings: [{
      actualValue: "supplierName, supplierTaxId e issuedAt",
      category: "EXTRACTION",
      description: "A estrutura invoice preenche supplierName, totalAmount, superName, superTexture e insuredAge.",
      evidence: "invoice.markdown",
      evidenceDetails: [],
      expectedValue: null,
      justification: "Compare documentNumber e lineNumber.",
      severity: "INFO",
      title: "Campos extraídos",
    }],
    id: "note-fields",
    isRead: false,
    issuedAt: null,
    primaryFinding: "invoice",
    processingJobStatus: null,
    readAt: null,
    readBy: null,
    responsibleName: "Responsável",
    status: "PENDING_VALIDATION" as NoteListItem["status"],
    supplierName: "Fornecedor",
    totalAmount: "100.00",
    version: 1,
    workName: "Obra",
  };

  const sanitized = sanitizeReviewerNoteListItem(original);
  const serialized = JSON.stringify({
    findings: sanitized.findings,
    primaryFinding: sanitized.primaryFinding,
  });
  assert.doesNotMatch(
    serialized,
    /supplierName|supplierTaxId|issuedAt|totalAmount|documentNumber|lineNumber|invoice|superName|superTexture|insuredAge/i,
  );
  assert.match(serialized, /nome do fornecedor|CNPJ do fornecedor|data do documento/i);
  assert.match(serialized, /nome do responsável|descrição do documento|idade informada/i);
});

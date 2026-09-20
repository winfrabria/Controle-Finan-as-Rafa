import "server-only";

import { AuditResult, NoteStatus } from "@/generated/prisma/enums";
import type { NoteListItem } from "@/features/internal-notes/note-list-query";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";
import { analysisFailureMessage } from "@/features/note-detail/analysis-failure";
import type { NoteVisualItem } from "./note-types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});
// Fiscal dates are calendar dates persisted at UTC midnight, not receipt timestamps.
const invoiceDateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function visualClassification(item: NoteListItem) {
  if (item.status === "FAILED") return "Falha de processamento";
  if (
    item.status === NoteStatus.READ_FAILED ||
    item.auditResult === AuditResult.READ_FAILED ||
    item.classification === "INCOMPATIBLE"
  ) {
    return "Falha de leitura";
  }
  if (
    item.status === "PROCESSING" &&
    (item.processingJobStatus === "PENDING" || item.processingJobStatus === "RUNNING")
  ) {
    return "Em análise";
  }
  if (
    item.auditResult === AuditResult.NEEDS_CONTEXT &&
    item.activeContextQuestionCount > 0
  ) {
    return "Precisa de informação";
  }
  if (item.findingCount > 0) return "Suspeita";
  // Legacy INFORMATION_INSUFFICIENT rows used NEEDS_CONTEXT + NO_PARAMETER
  // while also carrying status OK. They did not prove a complete analysis and
  // must not be presented as approved merely because the old row is terminal.
  if (
    item.auditResult === AuditResult.NEEDS_CONTEXT ||
    item.classification === "NO_PARAMETER"
  ) {
    return "Falha de leitura";
  }
  if (item.status === NoteStatus.OK) return "OK";
  if (item.auditResult === AuditResult.SUSPICIOUS) {
    return item.findingCount > 0 ? "Suspeita" : "Revisão manual";
  }
  if (item.auditResult === AuditResult.OK) return "OK";
  if (item.status === "RECEIVED") {
    if (
      item.processingJobStatus === "PENDING" ||
      item.processingJobStatus === "RUNNING"
    ) {
      return "Aguardando processamento";
    }
    if (
      item.processingJobStatus === "FAILED" ||
      item.processingJobStatus === "CANCELLED"
    ) {
      return "Falha de processamento";
    }
    return "Não processado";
  }
  if (item.status === "APPROVED" || item.classification === "OK") return "OK";
  if (item.status === "REJECTED" || item.classification === "SUSPICIOUS") {
    return item.findingCount > 0 ? "Suspeita" : "Revisão manual";
  }
  return "Em análise";
}

export function toNoteVisualItems(items: NoteListItem[]): NoteVisualItem[] {
  return items.map((item) => ({
    activeContextQuestionCount: item.activeContextQuestionCount,
    assurance: (item.status === "PROCESSING" || item.status === "RECEIVED") &&
      (item.processingJobStatus === "PENDING" || item.processingJobStatus === "RUNNING")
      ? null : item.assurance ?? null,
    classification: visualClassification(item),
    processingFailureMessage: visualClassification(item) === "Falha de processamento"
      ? item.processingFailureMessage ?? analysisFailureMessage("FAILED") : null,
    date: dateFormatter.format(item.createdAt),
    finding: item.primaryFinding ?? undefined,
    findingCount: item.findingCount,
    findings: item.findings,
    id: item.id,
    isRead: item.isRead,
    issuedAtLabel: item.issuedAt ? invoiceDateFormatter.format(item.issuedAt) : undefined,
    number: attachmentReference(item.documentNumber, item.id),
    responsible: item.responsibleName ?? undefined,
    readAt: item.readAt?.toISOString(),
    readAtLabel: item.readAt ? dateTimeFormatter.format(item.readAt) : undefined,
    readBy: item.readBy ?? undefined,
    supplier: item.supplierName ?? "Fornecedor não identificado",
    value: item.totalAmount
      ? moneyFormatter.format(Number(item.totalAmount))
      : "—",
    version: item.version,
    work: item.workName,
  }));
}

import "server-only";

import { AuditResult } from "@/generated/prisma/enums";
import type { NoteListItem } from "@/features/internal-notes/note-list-query";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";
import type { NoteVisualItem } from "./note-types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

function visualClassification(item: NoteListItem) {
  if (item.auditResult === AuditResult.READ_FAILED) return "Falha de leitura";
  if (item.auditResult === AuditResult.NEEDS_CONTEXT) return "Precisa de informação";
  if (item.auditResult === AuditResult.SUSPICIOUS) return "Suspeita";
  if (item.auditResult === AuditResult.OK) return "OK";
  if (item.status === "READ_FAILED" || item.classification === "INCOMPATIBLE") {
    return "Falha de leitura";
  }
  if (item.status === "FAILED") return "Falha de processamento";
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
    return "Suspeita";
  }
  if (item.classification === "NO_PARAMETER") return "Precisa de informação";
  return "Em análise";
}

export function toNoteVisualItems(items: NoteListItem[]): NoteVisualItem[] {
  return items.map((item) => ({
    classification: visualClassification(item),
    date: dateFormatter.format(item.issuedAt ?? item.createdAt),
    finding: item.primaryFinding ?? undefined,
    findings: item.findings,
    id: item.id,
    isRead: item.isRead,
    number: attachmentReference(item.documentNumber, item.id),
    responsible: item.responsibleName ?? undefined,
    supplier: item.supplierName ?? "Fornecedor não identificado",
    value: item.totalAmount
      ? moneyFormatter.format(Number(item.totalAmount))
      : "—",
    version: item.version,
    work: item.workName,
  }));
}

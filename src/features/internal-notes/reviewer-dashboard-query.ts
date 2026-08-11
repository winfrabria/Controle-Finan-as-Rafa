import "server-only";

import {
  AuditResult,
  FindingStatus,
  NoteStatus,
  ProcessingJobStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { normalizeResponsibleName } from "@/lib/works/responsible-name";

import type { ReviewerDashboardNote } from "@/features/workspace-ui/reviewer-dashboard-types";
import { sanitizeReviewerDashboardNote } from "./reviewer-payload-policy";
import { attachmentReference } from "./attachment-reference";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

function periodKey(value: Date) {
  const periodFormatter = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  });
  const parts = periodFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function classificationValue(note: {
  auditResult: AuditResult | null;
  classification: string | null;
  processingJobStatus: ProcessingJobStatus | null;
  status: NoteStatus;
}): ReviewerDashboardNote["classification"] {
  if (note.auditResult === AuditResult.READ_FAILED) return "Falha de leitura";
  if (note.auditResult === AuditResult.NEEDS_CONTEXT) return "Precisa de informação";
  if (note.auditResult === AuditResult.SUSPICIOUS) return "Suspeita";
  if (note.auditResult === AuditResult.OK) return "OK";
  if (note.status === NoteStatus.READ_FAILED) return "Falha de leitura";
  if (note.status === NoteStatus.FAILED) return "Falha de processamento";
  if (note.status === NoteStatus.RECEIVED) {
    if (
      note.processingJobStatus === ProcessingJobStatus.PENDING ||
      note.processingJobStatus === ProcessingJobStatus.RUNNING
    ) {
      return "Aguardando processamento";
    }
    if (
      note.processingJobStatus === ProcessingJobStatus.FAILED ||
      note.processingJobStatus === ProcessingJobStatus.CANCELLED
    ) {
      return "Falha de processamento";
    }
    return "Não processado";
  }
  if (note.status === NoteStatus.APPROVED) return "OK";
  if (note.status === NoteStatus.REJECTED) return "Suspeita";
  if (note.classification === "OK") return "OK";
  if (note.classification === "SUSPICIOUS") return "Suspeita";
  if (note.classification === "NO_PARAMETER") return "Precisa de informação";
  return "Em análise";
}

export async function listReviewerDashboardNotes(
  options: { sanitizeForReviewer?: boolean } = {},
): Promise<ReviewerDashboardNote[]> {
  const visibleFindingWhere = {
    status: { not: FindingStatus.FALSE_POSITIVE },
    ...(options.sanitizeForReviewer
      ? { category: { not: "DOCUMENT_TYPE" } }
      : {}),
  } as const;
  const notes = await prisma.note.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      auditResult: true,
      classification: true,
      createdAt: true,
      documentNumber: true,
      findings: {
        where: visibleFindingWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { category: true, title: true },
      },
      id: true,
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
      status: true,
      supplierName: true,
      totalAmount: true,
      work: {
        select: {
          id: true,
          name: true,
          responsibleName: true,
          responsibleProfile: { select: { email: true, fullName: true } },
        },
      },
    },
  });

  const items = notes.map((note) => {
    const reasons = [
      ...new Set(
        note.findings.map((finding) => finding.title || finding.category).filter(Boolean),
      ),
    ];

    return {
      classification: classificationValue({
        ...note,
        processingJobStatus: note.processingJobs[0]?.status ?? null,
      }),
      date: formatDate(note.createdAt),
      dateKey: periodKey(note.createdAt),
      id: note.id,
      number: attachmentReference(note.documentNumber, note.id),
      reasons,
      responsible:
        normalizeResponsibleName(
          note.work.responsibleName ??
            note.work.responsibleProfile?.fullName ??
            note.work.responsibleProfile?.email,
        ) ?? "Não definido",
      supplier: note.supplierName ?? "Fornecedor não identificado",
      value: note.totalAmount?.toFixed(2) ?? "0",
      work: note.work.name,
      workId: note.work.id,
    };
  });

  return options.sanitizeForReviewer
    ? items.map(sanitizeReviewerDashboardNote)
    : items;
}

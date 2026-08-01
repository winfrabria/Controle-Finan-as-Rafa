import "server-only";

import {
  FindingStatus,
  NoteStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";

import type { ReviewerDashboardNote } from "@/features/workspace-ui/reviewer-dashboard-types";

function formatDate(value: Date, isDateOnly: boolean) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: isDateOnly ? "UTC" : "America/Sao_Paulo",
  }).format(value);
}

function periodKey(value: Date, isDateOnly: boolean) {
  const periodFormatter = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: isDateOnly ? "UTC" : "America/Sao_Paulo",
    year: "numeric",
  });
  const parts = periodFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function classificationValue(note: {
  classification: string | null;
  status: NoteStatus;
}): ReviewerDashboardNote["classification"] {
  if (note.status === NoteStatus.READ_FAILED) return "Falha de leitura";
  if (note.status === NoteStatus.FAILED) return "Falha de processamento";
  if (note.classification === "OK") return "OK";
  if (note.classification === "SUSPICIOUS") return "Suspeita";
  if (note.classification === "NO_PARAMETER") return "Sem parâmetro";
  return "Em análise";
}

export async function listReviewerDashboardNotes(): Promise<ReviewerDashboardNote[]> {
  const notes = await prisma.note.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      classification: true,
      createdAt: true,
      documentNumber: true,
      findings: {
        where: { status: { not: FindingStatus.FALSE_POSITIVE } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { category: true, title: true },
      },
      id: true,
      issuedAt: true,
      status: true,
      supplierName: true,
      totalAmount: true,
      work: { select: { name: true } },
    },
  });

  return notes.map((note) => {
    const isDateOnly = Boolean(note.issuedAt);
    const date = note.issuedAt ?? note.createdAt;
    const reasons = [
      ...new Set(
        note.findings.map((finding) => finding.title || finding.category).filter(Boolean),
      ),
    ];

    return {
      classification: classificationValue(note),
      date: formatDate(date, isDateOnly),
      dateKey: periodKey(date, isDateOnly),
      id: note.id,
      number: note.documentNumber ?? "Sem número",
      reasons,
      supplier: note.supplierName ?? "Fornecedor não identificado",
      value: note.totalAmount?.toFixed(2) ?? "0",
      work: note.work.name,
    };
  });
}

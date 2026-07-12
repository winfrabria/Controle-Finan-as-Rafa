import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { NoteClassification, ValidationDecision } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";

export const VALIDATION_HISTORY_PAGE_SIZE = 6;

export type ValidationHistoryResult = "confirmed" | "released";

export type ValidationHistoryFilters = {
  dataAte?: string;
  dataDe?: string;
  obra?: string;
  pagina: number;
  resultado?: ValidationHistoryResult;
};

export type ValidationHistoryItem = {
  aiCorrect: boolean;
  comment: string | null;
  createdAt: Date;
  decision: ValidationDecision;
  findingTitle: string | null;
  id: string;
  noteId: string;
  noteIssuedAt: Date | null;
  noteNumber: string | null;
  reason: string;
  reviewerEmail: string;
  reviewerName: string | null;
  supplierName: string | null;
  totalAmount: string | null;
  workId: string;
  workName: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

const confirmedDecisions = [
  ValidationDecision.FINDING_CORRECT,
  ValidationDecision.SUSPICION_CONFIRMED,
] as const;

const releasedDecisions = [
  ValidationDecision.FALSE_POSITIVE,
  ValidationDecision.NOTE_VALID,
] as const;

const historyDecisions = [...confirmedDecisions, ...releasedDecisions];

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseValidationHistoryFilters(
  params: SearchParams,
): ValidationHistoryFilters {
  const page = Number.parseInt(firstValue(params.pagina) ?? "1", 10);
  const obra = firstValue(params.obra);
  const result = firstValue(params.resultado);

  return {
    dataAte: firstValue(params.dataAte),
    dataDe: firstValue(params.dataDe),
    obra: obra && /^[0-9a-f-]{36}$/i.test(obra) ? obra : undefined,
    pagina: Number.isFinite(page) && page > 0 ? page : 1,
    resultado:
      result === "confirmed" || result === "released" ? result : undefined,
  };
}

function decisionsFor(result?: ValidationHistoryResult) {
  if (result === "confirmed") return [...confirmedDecisions];
  if (result === "released") return [...releasedDecisions];
  return historyDecisions;
}

function baseWhere(filters: ValidationHistoryFilters) {
  const createdAt = {
    gte: parseDate(filters.dataDe),
    lte: parseDate(filters.dataAte, true),
  };

  return {
    note: {
      classification: NoteClassification.SUSPICIOUS,
      ...(filters.obra ? { workId: filters.obra } : {}),
    },
    ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
  } satisfies Prisma.ValidationWhereInput;
}

export async function listValidationHistory(filters: ValidationHistoryFilters) {
  const base = baseWhere(filters);
  const where = {
    ...base,
    decision: { in: decisionsFor(filters.resultado) },
  } satisfies Prisma.ValidationWhereInput;
  const confirmedWhere = {
    ...base,
    decision: { in: [...confirmedDecisions] },
  } satisfies Prisma.ValidationWhereInput;
  const releasedWhere = {
    ...base,
    decision: { in: [...releasedDecisions] },
  } satisfies Prisma.ValidationWhereInput;

  const [total, validations, confirmed, released, storedHistory, works] =
    await prisma.$transaction([
      prisma.validation.count({ where }),
      prisma.validation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.pagina - 1) * VALIDATION_HISTORY_PAGE_SIZE,
        take: VALIDATION_HISTORY_PAGE_SIZE,
        select: {
          comment: true,
          createdAt: true,
          decision: true,
          finding: { select: { title: true } },
          id: true,
          note: {
            select: {
              createdAt: true,
              documentNumber: true,
              id: true,
              issuedAt: true,
              supplierName: true,
              totalAmount: true,
              work: { select: { id: true, name: true } },
            },
          },
          reason: true,
          validator: { select: { email: true, fullName: true } },
        },
      }),
      prisma.validation.count({ where: confirmedWhere }),
      prisma.validation.count({ where: releasedWhere }),
      prisma.validation.count({
        where: {
          decision: { in: historyDecisions },
          note: { classification: NoteClassification.SUSPICIOUS },
        },
      }),
      prisma.work.findMany({
        orderBy: [{ active: "desc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ]);

  const items: ValidationHistoryItem[] = validations.map((validation) => ({
    aiCorrect: confirmedDecisions.includes(
      validation.decision as (typeof confirmedDecisions)[number],
    ),
    comment: validation.comment,
    createdAt: validation.createdAt,
    decision: validation.decision,
    findingTitle: validation.finding?.title ?? null,
    id: validation.id,
    noteId: validation.note.id,
    noteIssuedAt: validation.note.issuedAt ?? validation.note.createdAt,
    noteNumber: validation.note.documentNumber,
    reason: validation.reason,
    reviewerEmail: validation.validator.email,
    reviewerName: validation.validator.fullName,
    supplierName: validation.note.supplierName,
    totalAmount: validation.note.totalAmount?.toFixed(2) ?? null,
    workId: validation.note.work.id,
    workName: validation.note.work.name,
  }));

  return {
    confirmed,
    hasStoredHistory: storedHistory > 0,
    items,
    page: filters.pagina,
    pageCount: Math.max(1, Math.ceil(total / VALIDATION_HISTORY_PAGE_SIZE)),
    released,
    total,
    works,
  };
}

export function buildValidationHistoryPageHref(
  pathname: string,
  params: SearchParams,
  page: number,
) {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const selected = firstValue(value);
    if (selected && key !== "pagina") next.set(key, selected);
  }

  if (page > 1) next.set("pagina", String(page));
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { NoteClassification, ValidationDecision } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";

export const VALIDATION_HISTORY_PAGE_SIZE = 6;

export type ValidationHistoryResult = "confirmed" | "released";

export type ValidationHistoryFilters = {
  busca?: string;
  dataAte?: string;
  dataDe?: string;
  obra?: string;
  pagina: number;
  resultado?: ValidationHistoryResult;
  validacao?: string;
};

export type ValidationHistoryItem = {
  aiCorrect: boolean;
  comment: string | null;
  createdAt: Date;
  decision: ValidationDecision;
  findingEvidence: string[];
  findingJustification: string | null;
  findingSource: string | null;
  findingTitle: string | null;
  id: string;
  noteId: string;
  noteNumber: string | null;
  reason: string;
  reviewerEmail: string;
  reviewerName: string | null;
  supplierName: string | null;
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

const validationHistorySelect = {
  comment: true,
  createdAt: true,
  decision: true,
  finding: {
    select: {
      evidence: true,
      justification: true,
      source: true,
      title: true,
    },
  },
  findingSnapshot: true,
  id: true,
  note: {
    select: {
      documentNumber: true,
      id: true,
      supplierName: true,
      work: { select: { id: true, name: true } },
    },
  },
  reason: true,
  validator: { select: { email: true, fullName: true } },
} satisfies Prisma.ValidationSelect;

type ValidationHistoryRecord = Prisma.ValidationGetPayload<{
  select: typeof validationHistorySelect;
}>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseText(value: string | undefined) {
  const normalized = value?.trim().slice(0, 120);
  return normalized || undefined;
}

function parseUuid(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

export function parseValidationHistoryFilters(
  params: SearchParams,
): ValidationHistoryFilters {
  const page = Number.parseInt(firstValue(params.pagina) ?? "1", 10);
  const result = firstValue(params.resultado);

  return {
    busca: parseText(firstValue(params.busca)),
    dataAte: firstValue(params.dataAte),
    dataDe: firstValue(params.dataDe),
    obra: parseUuid(firstValue(params.obra)),
    pagina: Number.isFinite(page) && page > 0 ? page : 1,
    resultado:
      result === "confirmed" || result === "released" ? result : undefined,
    validacao: parseUuid(firstValue(params.validacao)),
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
  const search = filters.busca;

  return {
    note: {
      classification: NoteClassification.SUSPICIOUS,
      ...(filters.obra ? { workId: filters.obra } : {}),
      ...(search
        ? {
            OR: [
              { documentNumber: { contains: search, mode: "insensitive" as const } },
              { supplierName: { contains: search, mode: "insensitive" as const } },
              { work: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
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

  const { total, validations, confirmed, released, overallTotal, selected, works } =
    await prisma.$transaction(async (transaction) => {
      const total = await transaction.validation.count({ where });
      const validations = await transaction.validation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.pagina - 1) * VALIDATION_HISTORY_PAGE_SIZE,
        take: VALIDATION_HISTORY_PAGE_SIZE,
        select: validationHistorySelect,
      });
      const confirmed = await transaction.validation.count({ where: confirmedWhere });
      const released = await transaction.validation.count({ where: releasedWhere });
      const overallTotal = await transaction.validation.count({
        where: {
          ...base,
          decision: { in: historyDecisions },
        },
      });
      const selected = await transaction.validation.findFirst({
        where: {
          ...base,
          decision: { in: historyDecisions },
          id:
            filters.validacao ??
            "00000000-0000-4000-8000-000000000000",
        },
        select: validationHistorySelect,
      });
      const works = await transaction.work.findMany({
        orderBy: [{ active: "desc" }, { name: "asc" }],
        select: { id: true, name: true },
      });
      return { confirmed, overallTotal, released, selected, total, validations, works };
    });

  const items = validations.map(toHistoryItem);

  return {
    confirmed,
    items,
    overallTotal,
    page: filters.pagina,
    pageCount: Math.max(1, Math.ceil(total / VALIDATION_HISTORY_PAGE_SIZE)),
    released,
    selectedItem: selected ? toHistoryItem(selected) : items[0] ?? null,
    total,
    works,
  };
}

function toHistoryItem(validation: ValidationHistoryRecord): ValidationHistoryItem {
  const snapshot = asRecord(validation.findingSnapshot);
  const snapshotEvidence = snapshot ? snapshot.evidence : null;
  const evidence = formatEvidence(
    snapshotEvidence ?? validation.finding?.evidence ?? null,
  );

  return {
    aiCorrect: confirmedDecisions.includes(
      validation.decision as (typeof confirmedDecisions)[number],
    ),
    comment: validation.comment,
    createdAt: validation.createdAt,
    decision: validation.decision,
    findingEvidence: evidence,
    findingJustification:
      textValue(snapshot?.justification) ??
      validation.finding?.justification ??
      null,
    findingSource:
      textValue(snapshot?.source) ?? validation.finding?.source ?? null,
    findingTitle:
      textValue(snapshot?.title) ?? validation.finding?.title ?? null,
    id: validation.id,
    noteId: validation.note.id,
    noteNumber: validation.note.documentNumber,
    reason: validation.reason,
    reviewerEmail: validation.validator.email,
    reviewerName: validation.validator.fullName,
    supplierName: validation.note.supplierName,
    workId: validation.note.work.id,
    workName: validation.note.work.name,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatEvidence(value: unknown) {
  const record = asRecord(value);
  if (!record) return [];

  return Object.entries(record)
    .slice(0, 5)
    .map(([key, entry]) => `${humanizeKey(key)}: ${displayValue(entry)}`);
}

function humanizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "não informado";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "evidência registrada";
  }
}

export function buildValidationHistoryPageHref(
  pathname: string,
  params: SearchParams,
  page: number,
) {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const selected = firstValue(value);
    if (selected && key !== "pagina" && key !== "validacao") {
      next.set(key, selected);
    }
  }

  if (page > 1) next.set("pagina", String(page));
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

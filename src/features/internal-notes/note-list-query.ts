import "server-only";

import {
  FindingStatus,
  NoteClassification,
  NoteStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

export const NOTES_PAGE_SIZE = 10;

export type NoteListFilters = {
  classificacao?: NoteClassification;
  dataAte?: string;
  dataDe?: string;
  fornecedor?: string;
  obra?: string;
  pagina: number;
  status?: NoteStatus;
  valorMax?: number;
  valorMin?: number;
};

export type NoteListItem = {
  classification: NoteClassification | null;
  createdAt: Date;
  documentNumber: string | null;
  findingCount: number;
  id: string;
  issuedAt: Date | null;
  primaryFinding: string | null;
  status: NoteStatus;
  supplierName: string | null;
  totalAmount: string | null;
  version: number;
  workName: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseEnum<T extends string>(value: string | undefined, values: T[]) {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseMoney(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseNoteListFilters(params: SearchParams): NoteListFilters {
  const page = Number.parseInt(firstValue(params.pagina) ?? "1", 10);
  const fornecedor = firstValue(params.fornecedor)?.trim().slice(0, 120);
  const obra = firstValue(params.obra);

  return {
    classificacao: parseEnum(
      firstValue(params.classificacao),
      Object.values(NoteClassification),
    ),
    dataAte: firstValue(params.dataAte),
    dataDe: firstValue(params.dataDe),
    fornecedor: fornecedor || undefined,
    obra: obra && /^[0-9a-f-]{36}$/i.test(obra) ? obra : undefined,
    pagina: Number.isFinite(page) && page > 0 ? page : 1,
    status: parseEnum(firstValue(params.status), Object.values(NoteStatus)),
    valorMax: parseMoney(firstValue(params.valorMax)),
    valorMin: parseMoney(firstValue(params.valorMin)),
  };
}

function buildWhere(filters: NoteListFilters, validationOnly: boolean) {
  const createdAt = {
    gte: parseDate(filters.dataDe),
    lte: parseDate(filters.dataAte, true),
  };
  const totalAmount = {
    gte: filters.valorMin,
    lte: filters.valorMax,
  };

  return {
    ...(validationOnly
      ? {
          status: NoteStatus.PENDING_VALIDATION,
        }
      : filters.status
        ? { status: filters.status }
        : {}),
    ...(filters.classificacao
      ? { classification: filters.classificacao }
      : {}),
    ...(filters.obra ? { workId: filters.obra } : {}),
    ...(filters.fornecedor
      ? {
          supplierName: {
            contains: filters.fornecedor,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
    ...(totalAmount.gte !== undefined || totalAmount.lte !== undefined
      ? { totalAmount }
      : {}),
  } satisfies Prisma.NoteWhereInput;
}

export async function listNotes(
  filters: NoteListFilters,
  options: { validationOnly?: boolean } = {},
) {
  const validationOnly = options.validationOnly ?? false;
  const where = buildWhere(filters, validationOnly);
  const [total, notes, works] = await prisma.$transaction([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      orderBy: validationOnly
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.pagina - 1) * NOTES_PAGE_SIZE,
      take: NOTES_PAGE_SIZE,
      select: {
        classification: true,
        createdAt: true,
        documentNumber: true,
        findings: {
          where: {
            needsValidation: true,
            status: FindingStatus.OPEN,
          },
          orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
          select: { title: true },
        },
        id: true,
        issuedAt: true,
        status: true,
        supplierName: true,
        totalAmount: true,
        version: true,
        work: { select: { name: true } },
      },
    }),
    prisma.work.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const items: NoteListItem[] = notes.map((note) => ({
    classification: note.classification,
    createdAt: note.createdAt,
    documentNumber: note.documentNumber,
    findingCount: note.findings.length,
    id: note.id,
    issuedAt: note.issuedAt,
    primaryFinding: note.findings[0]?.title ?? null,
    status: note.status,
    supplierName: note.supplierName,
    totalAmount: note.totalAmount?.toFixed(2) ?? null,
    version: note.version,
    workName: note.work.name,
  }));

  return {
    items,
    page: filters.pagina,
    pageCount: Math.max(1, Math.ceil(total / NOTES_PAGE_SIZE)),
    total,
    works,
  };
}

export function buildPageHref(
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

import "server-only";

import {
  FindingStatus,
  NoteClassification,
  NoteStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

function stringifyJson(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export const NOTES_PAGE_SIZE = 10;

export type NoteListFilters = {
  classificacao?: NoteClassification;
  dataAte?: string;
  dataDe?: string;
  documentNumber?: string;
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
  findings: {
    actualValue: string | null;
    category: string;
    description: string;
    evidence: string | null;
    expectedValue: string | null;
    justification: string;
    severity: string;
    title: string;
  }[];
  id: string;
  isRead: boolean;
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
  const documentNumber = firstValue(params.busca)?.trim().slice(0, 80);
  const obra = firstValue(params.obra);

  return {
    classificacao: parseEnum(
      firstValue(params.classificacao),
      Object.values(NoteClassification),
    ),
    dataAte: firstValue(params.dataAte),
    dataDe: firstValue(params.dataDe),
    documentNumber: documentNumber || undefined,
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
    ...(filters.documentNumber
      ? {
          documentNumber: {
            contains: filters.documentNumber,
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
  options: { profileId?: string; validationOnly?: boolean } = {},
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
          take: 3,
          select: {
            actualValue: true,
            category: true,
            description: true,
            evidence: true,
            expectedValue: true,
            justification: true,
            severity: true,
            title: true,
          },
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

  const readIds = options.profileId
    ? new Set(
        (
          await prisma.noteRead.findMany({
            where: {
              noteId: { in: notes.map((note) => note.id) },
              profileId: options.profileId,
            },
            select: { noteId: true },
          })
        ).map((entry) => entry.noteId),
      )
    : new Set<string>();

  const items: NoteListItem[] = notes.map((note) => ({
    classification: note.classification,
    createdAt: note.createdAt,
    documentNumber: note.documentNumber,
    findingCount: note.findings.length,
    findings: note.findings.map((finding) => ({
      actualValue: stringifyJson(finding.actualValue),
      category: finding.category,
      description: finding.description,
      evidence: stringifyJson(finding.evidence),
      expectedValue: stringifyJson(finding.expectedValue),
      justification: finding.justification,
      severity: finding.severity,
      title: finding.title,
    })),
    id: note.id,
    isRead: readIds.has(note.id),
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

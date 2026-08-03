import "server-only";

import {
  AuditResult,
  FindingStatus,
  NoteClassification,
  NoteStatus,
  ProcessingJobStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

import { formatFindingValue } from "./finding-display";
import { sanitizeReviewerNoteListItem } from "./reviewer-payload-policy";

function stringifyJson(value: unknown) {
  if (value === null || value === undefined) return null;
  return formatFindingValue(value);
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
  auditResult: AuditResult | null;
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
  processingJobStatus: ProcessingJobStatus | null;
  responsibleName: string | null;
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
  options: {
    all?: boolean;
    profileId?: string;
    sanitizeForReviewer?: boolean;
    validationOnly?: boolean;
  } = {},
) {
  const validationOnly = options.validationOnly ?? false;
  const where = {
    ...buildWhere(filters, validationOnly),
    ...(options.profileId
      ? {
          noteReads: {
            none: { profileId: options.profileId },
          },
        }
      : {}),
  } satisfies Prisma.NoteWhereInput;
  const [total, notes, works] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      orderBy: validationOnly
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
      ...(options.all
        ? {}
        : {
            skip: (filters.pagina - 1) * NOTES_PAGE_SIZE,
            take: NOTES_PAGE_SIZE,
          }),
      select: {
        auditResult: true,
        classification: true,
        createdAt: true,
        documentNumber: true,
        findings: {
          where: {
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
        _count: {
          select: {
            findings: { where: { status: FindingStatus.OPEN } },
          },
        },
        id: true,
        issuedAt: true,
        noteReads: {
          select: { profileId: true },
        },
        processingJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
        status: true,
        supplierName: true,
        totalAmount: true,
        version: true,
        work: {
          select: {
            name: true,
            responsibleName: true,
            responsibleProfile: { select: { email: true, fullName: true } },
          },
        },
      },
    }),
    prisma.work.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const rawItems: NoteListItem[] = notes.map((note) => ({
    auditResult: note.auditResult,
    classification: note.classification,
    createdAt: note.createdAt,
    documentNumber: note.documentNumber,
    findingCount: note._count.findings,
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
    isRead: Boolean(
      options.profileId &&
        note.noteReads.some((read) => read.profileId === options.profileId),
    ),
    issuedAt: note.issuedAt,
    primaryFinding: note.findings[0]?.title ?? null,
    processingJobStatus: note.processingJobs[0]?.status ?? null,
    responsibleName:
      note.work.responsibleName ??
      note.work.responsibleProfile?.fullName ??
      note.work.responsibleProfile?.email ??
      null,
    status: note.status,
    supplierName: note.supplierName,
    totalAmount: note.totalAmount?.toFixed(2) ?? null,
    version: note.version,
    workName: note.work.name,
  }));
  const items = options.sanitizeForReviewer
    ? rawItems.map(sanitizeReviewerNoteListItem)
    : rawItems;

  return {
    items,
    page: filters.pagina,
    pageCount: options.all ? 1 : Math.max(1, Math.ceil(total / NOTES_PAGE_SIZE)),
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

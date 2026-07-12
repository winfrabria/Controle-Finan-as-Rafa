import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  CreateAdminWorkInput,
  ListAdminWorksQuery,
  UpdateAdminWorkInput,
} from "@/lib/works/admin-work-contract";
import { prisma } from "@/server/db/prisma";

export class WorkNotFoundError extends Error {
  constructor() {
    super("Obra não encontrada.");
    this.name = "WorkNotFoundError";
  }
}

export class WorkCodeConflictError extends Error {
  constructor() {
    super("Já existe uma obra com esse código.");
    this.name = "WorkCodeConflictError";
  }
}

const adminWorkSelect = {
  id: true,
  code: true,
  name: true,
  location: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { notes: true } },
} satisfies Prisma.WorkSelect;

function serializeWork(work: {
  id: string;
  code: string;
  name: string;
  location: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { notes: number };
}) {
  return {
    id: work.id,
    codigo: work.code,
    nome: work.name,
    local: work.location,
    ativa: work.active,
    totalNotas: work._count.notes,
    criadaEm: work.createdAt.toISOString(),
    atualizadaEm: work.updatedAt.toISOString(),
  };
}

function mapWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new WorkCodeConflictError();
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    throw new WorkNotFoundError();
  }

  throw error;
}

async function ensureUniqueWorkCode(code: string, exceptId?: string) {
  const existing = await prisma.work.findFirst({
    where: {
      code: { equals: code, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (existing) throw new WorkCodeConflictError();
}

export async function listAdminWorks(query: ListAdminWorksQuery) {
  const where: Prisma.WorkWhereInput = {
    ...(query.status === "ativas"
      ? { active: true }
      : query.status === "inativas"
        ? { active: false }
        : {}),
    ...(query.busca
      ? {
          OR: [
            { code: { contains: query.busca, mode: "insensitive" } },
            { name: { contains: query.busca, mode: "insensitive" } },
            { location: { contains: query.busca, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const skip = (query.pagina - 1) * query.porPagina;

  const [works, total] = await prisma.$transaction([
    prisma.work.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
      skip,
      take: query.porPagina,
      select: adminWorkSelect,
    }),
    prisma.work.count({ where }),
  ]);

  return {
    obras: works.map(serializeWork),
    paginacao: {
      pagina: query.pagina,
      porPagina: query.porPagina,
      total,
      totalPaginas: Math.ceil(total / query.porPagina),
    },
  };
}

export async function getAdminWork(id: string) {
  const work = await prisma.work.findUnique({
    where: { id },
    select: adminWorkSelect,
  });

  if (!work) throw new WorkNotFoundError();

  return serializeWork(work);
}

export async function createAdminWork(input: CreateAdminWorkInput) {
  await ensureUniqueWorkCode(input.codigo);

  try {
    const work = await prisma.work.create({
      data: {
        code: input.codigo,
        name: input.nome,
        location: input.local,
      },
      select: adminWorkSelect,
    });

    return serializeWork(work);
  } catch (error) {
    mapWriteError(error);
  }
}

export async function updateAdminWork(id: string, input: UpdateAdminWorkInput) {
  if (input.codigo !== undefined) {
    await ensureUniqueWorkCode(input.codigo, id);
  }

  try {
    const work = await prisma.work.update({
      where: { id },
      data: {
        ...(input.codigo !== undefined ? { code: input.codigo } : {}),
        ...(input.nome !== undefined ? { name: input.nome } : {}),
        ...(input.local !== undefined ? { location: input.local } : {}),
        ...(input.ativa !== undefined ? { active: input.ativa } : {}),
      },
      select: adminWorkSelect,
    });

    return serializeWork(work);
  } catch (error) {
    mapWriteError(error);
  }
}

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  CreateAdminWorkInput,
  ListAdminWorksQuery,
  UpdateAdminWorkInput,
} from "@/lib/works/admin-work-contract";
import {
  parseAdminWorksCsv,
  type AdminWorkImportIssue,
} from "@/lib/works/admin-work-import";
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

export class WorkResponsibleNotFoundError extends Error {
  constructor() {
    super("O responsável selecionado não existe ou está inativo.");
    this.name = "WorkResponsibleNotFoundError";
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
  responsibleProfile: {
    select: { id: true, email: true, fullName: true, role: true },
  },
  _count: { select: { notes: true } },
} satisfies Prisma.WorkSelect;

type SelectedAdminWork = Prisma.WorkGetPayload<{ select: typeof adminWorkSelect }>;

function serializeWork(work: SelectedAdminWork) {
  return {
    id: work.id,
    codigo: work.code,
    nome: work.name,
    local: work.location,
    ativa: work.active,
    responsavel: work.responsibleProfile
      ? {
          id: work.responsibleProfile.id,
          nome: work.responsibleProfile.fullName,
          email: work.responsibleProfile.email,
          papel: work.responsibleProfile.role,
        }
      : null,
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

async function ensureActiveResponsible(profileId: string) {
  const responsible = await prisma.profile.findFirst({
    where: { id: profileId, active: true },
    select: { id: true },
  });
  if (!responsible) throw new WorkResponsibleNotFoundError();
}

export async function listResponsibleProfiles() {
  const profiles = await prisma.profile.findMany({
    where: { active: true },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
    select: { id: true, email: true, fullName: true, role: true },
  });

  return profiles.map((profile) => ({
    id: profile.id,
    nome: profile.fullName,
    email: profile.email,
    papel: profile.role,
  }));
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
            {
              responsibleProfile: {
                is: {
                  OR: [
                    { fullName: { contains: query.busca, mode: "insensitive" } },
                    { email: { contains: query.busca, mode: "insensitive" } },
                  ],
                },
              },
            },
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
  await ensureActiveResponsible(input.responsavelId);

  try {
    const work = await prisma.work.create({
      data: {
        code: input.codigo,
        name: input.nome,
        location: input.local,
        active: input.ativa,
        responsibleProfileId: input.responsavelId,
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
  if (input.responsavelId) {
    await ensureActiveResponsible(input.responsavelId);
  }

  try {
    const work = await prisma.work.update({
      where: { id },
      data: {
        ...(input.codigo !== undefined ? { code: input.codigo } : {}),
        ...(input.nome !== undefined ? { name: input.nome } : {}),
        ...(input.local !== undefined ? { location: input.local } : {}),
        ...(input.responsavelId !== undefined
          ? { responsibleProfileId: input.responsavelId }
          : {}),
        ...(input.ativa !== undefined ? { active: input.ativa } : {}),
      },
      select: adminWorkSelect,
    });

    return serializeWork(work);
  } catch (error) {
    mapWriteError(error);
  }
}

export async function importAdminWorks(csv: string, apply: boolean) {
  const parsed = parseAdminWorksCsv(csv);

  return prisma.$transaction(async (transaction) => {
    const issues: AdminWorkImportIssue[] = [...parsed.issues];
    const codeLines = new Map<string, number[]>();
    for (const row of parsed.rows) {
      codeLines.set(row.codigo, [...(codeLines.get(row.codigo) ?? []), row.linha]);
    }
    for (const [code, lines] of codeLines) {
      if (lines.length > 1) {
        for (const line of lines) {
          issues.push({
            linha: line,
            campo: "codigo",
            mensagem: `O código ${code} está repetido no arquivo.`,
          });
        }
      }
    }

    const emails = [...new Set(parsed.rows.map((row) => row.responsavelEmail))];
    const codes = [...new Set(parsed.rows.map((row) => row.codigo))];
    const [profiles, existingWorks] = await Promise.all([
      transaction.profile.findMany({
        where: { active: true, email: { in: emails, mode: "insensitive" } },
        select: { id: true, email: true, fullName: true },
      }),
      transaction.work.findMany({
        where: { code: { in: codes, mode: "insensitive" } },
        select: { code: true },
      }),
    ]);
    const profileByEmail = new Map(
      profiles.map((profile) => [profile.email.toLowerCase(), profile]),
    );
    const existingCodes = new Set(existingWorks.map((work) => work.code.toUpperCase()));

    for (const row of parsed.rows) {
      if (!profileByEmail.has(row.responsavelEmail)) {
        issues.push({
          linha: row.linha,
          campo: "responsavel_email",
          mensagem: "Responsável não encontrado ou inativo.",
        });
      }
      if (existingCodes.has(row.codigo)) {
        issues.push({
          linha: row.linha,
          campo: "codigo",
          mensagem: `Já existe uma obra com o código ${row.codigo}.`,
        });
      }
    }

    if (apply && issues.length === 0) {
      await transaction.work.createMany({
        data: parsed.rows.map((row) => ({
          code: row.codigo,
          name: row.nome,
          location: row.local,
          active: row.ativa,
          responsibleProfileId: profileByEmail.get(row.responsavelEmail)!.id,
        })),
      });
    }

    return {
      valido: issues.length === 0,
      aplicado: apply && issues.length === 0,
      totalLinhas: parsed.rows.length,
      erros: issues,
      obras: parsed.rows.map((row) => ({
        linha: row.linha,
        codigo: row.codigo,
        nome: row.nome,
        local: row.local,
        responsavelEmail: row.responsavelEmail,
        responsavelNome:
          profileByEmail.get(row.responsavelEmail)?.fullName ?? null,
        ativa: row.ativa,
      })),
    };
  });
}

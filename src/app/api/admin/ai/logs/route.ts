import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: NextRequest) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ erro: { codigo: "CONSULTA_INVALIDA", mensagem: "Filtros inválidos." } }, { status: 400 });
  }
  const [administrative, aiRuns, validations] = await prisma.$transaction([
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
    }),
    prisma.aiRun.findMany({
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
      include: {
        note: {
          select: {
            classification: true,
            documentNumber: true,
            id: true,
            status: true,
          },
        },
      },
    }),
    prisma.validation.findMany({
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
      include: {
        note: { select: { documentNumber: true, id: true } },
        validator: { select: { email: true, fullName: true } },
      },
    }),
  ]);
  return NextResponse.json(
    { administrative, aiRuns, validations },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

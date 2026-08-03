import { NextResponse } from "next/server";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const run = await prisma.aiRun.findUnique({
    where: { id },
    include: {
      findings: {
        orderBy: { createdAt: "asc" },
      },
      note: {
        select: {
          auditResult: true,
          classification: true,
          documentNumber: true,
          id: true,
          status: true,
          supplierName: true,
        },
      },
      processingJob: {
        select: {
          attempt: true,
          id: true,
          lastErrorCode: true,
          status: true,
        },
      },
    },
  });

  if (!run) {
    return NextResponse.json(
      { erro: { codigo: "EXECUCAO_NAO_ENCONTRADA", mensagem: "Execução não encontrada." } },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { run },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  noteId: z.string().uuid().optional(),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: NextRequest) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ erro: { codigo: "CONSULTA_INVALIDA", mensagem: "Filtros inválidos." } }, { status: 400 });
  }
  const runs = await prisma.aiRun.findMany({
    where: { noteId: parsed.data.noteId, status: parsed.data.status },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit,
    select: {
      attempts: true,
      completedAt: true,
      completionTokens: true,
      costUsd: true,
      createdAt: true,
      errorCode: true,
      id: true,
      kind: true,
      latencyMs: true,
      model: true,
      noteId: true,
      policyVersion: true,
      promptTokens: true,
      promptVersion: true,
      provider: true,
      reasoningEffort: true,
      schemaVersion: true,
      status: true,
      structuredResponse: true,
      totalTokens: true,
    },
  });
  return NextResponse.json({ runs }, { headers: { "Cache-Control": "private, no-store" } });
}


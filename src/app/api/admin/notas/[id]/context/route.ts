import { NextResponse } from "next/server";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_INVALIDA", mensagem: "Anexo inválido." } },
      { status: 400 },
    );
  }

  const note = await prisma.note.findUnique({
    where: { id },
    select: {
      auditResult: true,
      contextRound: true,
      contextSummary: true,
      contextQuestions: {
        orderBy: [{ round: "asc" }, { position: "asc" }],
        select: {
          aiRunId: true,
          code: true,
          createdAt: true,
          id: true,
          options: true,
          position: true,
          prompt: true,
          rationale: true,
          required: true,
          round: true,
          type: true,
          answers: {
            orderBy: { createdAt: "asc" },
            select: {
              createdAt: true,
              id: true,
              submission: { select: { id: true, round: true, status: true, submittedAt: true } },
              value: true,
            },
          },
        },
      },
      contextSubmissions: {
        orderBy: { submittedAt: "asc" },
        select: {
          answerFingerprint: true,
          id: true,
          processingJob: { select: { completedAt: true, id: true, status: true } },
          reanalysisCompletedAt: true,
          reanalysisQueuedAt: true,
          round: true,
          status: true,
          submittedAt: true,
        },
      },
      id: true,
      publicProtocol: true,
    },
  });
  if (!note) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Anexo não encontrado." } },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      nota: {
        auditResult: note.auditResult,
        contextRound: note.contextRound,
        contextSummary: note.contextSummary,
        id: note.id,
        protocolo: note.publicProtocol,
      },
      perguntas: note.contextQuestions,
      respostas: note.contextSubmissions,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}


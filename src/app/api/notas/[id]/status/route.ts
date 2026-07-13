import { NextResponse } from "next/server";

import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_INVALIDA", mensagem: "Nota inválida." } },
      { status: 400 },
    );
  }

  const note = await prisma.note.findUnique({
    where: { id },
    select: {
      classification: true,
      failureCode: true,
      failureMessage: true,
      id: true,
      processingStage: true,
      status: true,
      _count: { select: { findings: { where: { needsValidation: true } } } },
      processingJobs: {
        orderBy: { createdAt: "desc" },
        select: { attempt: true, id: true, status: true },
        take: 1,
      },
    },
  });

  if (!note) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Nota não encontrada." } },
      { status: 404 },
    );
  }

  const response = {
    nota: {
      etapa: note.processingStage,
      id: note.id,
      ...(note.status === "READ_FAILED"
        ? { classificacao: "READ_FAILED" }
        : note.classification
          ? {
              classificacao: note.classification,
            }
          : {}),
      achados: note._count.findings,
      ...(note.processingJobs[0]
        ? {
            job: {
              id: note.processingJobs[0].id,
              status: note.processingJobs[0].status,
              tentativa: note.processingJobs[0].attempt,
            },
          }
        : {}),
      status: note.status,
      ...(note.failureCode && note.failureMessage
        ? {
            erro: {
              codigo: note.failureCode,
              mensagem: note.failureMessage,
            },
          }
        : {}),
    },
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}

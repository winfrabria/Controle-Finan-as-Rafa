import { NextResponse } from "next/server";

import type { NoteStatusResponse } from "@/lib/notes/upload-contract";
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
      failureCode: true,
      failureMessage: true,
      id: true,
      processingStage: true,
      status: true,
    },
  });

  if (!note) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Nota não encontrada." } },
      { status: 404 },
    );
  }

  const response: NoteStatusResponse = {
    nota: {
      etapa: note.processingStage,
      id: note.id,
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

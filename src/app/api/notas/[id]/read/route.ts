import { NextResponse } from "next/server";

import { AuditResult, NoteStatus } from "@/generated/prisma/enums";
import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_INVALIDA", mensagem: "Nota inválida." } },
      { status: 400 },
    );
  }

  const note = await prisma.note.findUnique({
    where: { id },
    select: { auditResult: true, id: true, status: true },
  });
  if (!note) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Nota não encontrada." } },
      { status: 404 },
    );
  }
  const hasTerminalDiagnosis =
    note.auditResult === AuditResult.OK ||
    note.auditResult === AuditResult.SUSPICIOUS ||
    note.auditResult === AuditResult.READ_FAILED;
  if (
    !hasTerminalDiagnosis &&
    (note.status === NoteStatus.RECEIVED || note.status === NoteStatus.PROCESSING)
  ) {
    return NextResponse.json(
      {
        erro: {
          codigo: "ANALISE_EM_ANDAMENTO",
          mensagem: "Aguarde a conclusão da análise antes de marcar como lida.",
        },
      },
      { status: 409 },
    );
  }

  const readAt = new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.noteRead.upsert({
      where: {
        profileId_noteId: { noteId: id, profileId: access.profile.id },
      },
      create: { noteId: id, profileId: access.profile.id, readAt },
      update: { readAt },
    });
    await transaction.notification.updateMany({
      where: {
        noteId: id,
        recipientId: access.profile.id,
        readAt: null,
      },
      data: { readAt },
    });
  });

  return NextResponse.json({ nota: { id, lidaEm: readAt.toISOString() } });
}

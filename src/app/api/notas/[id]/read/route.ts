import { NextResponse } from "next/server";

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
    select: { id: true },
  });
  if (!note) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Nota não encontrada." } },
      { status: 404 },
    );
  }

  const readAt = new Date();
  await prisma.$transaction([
    prisma.noteRead.upsert({
      where: {
        profileId_noteId: { noteId: id, profileId: access.profile.id },
      },
      create: { noteId: id, profileId: access.profile.id, readAt },
      update: { readAt },
    }),
    prisma.notification.updateMany({
      where: {
        noteId: id,
        recipientId: access.profile.id,
        readAt: null,
      },
      data: { readAt },
    }),
  ]);

  return NextResponse.json({ nota: { id, lidaEm: readAt.toISOString() } });
}

import "server-only";
import { prisma } from "@/server/db/prisma";

export class NoteReadError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "NoteReadError";
  }
}

export async function recordNoteRead(noteId: string, profileId: string, expectedVersion?: number) {
  return prisma.$transaction(async (transaction) => {
    // Serialize with reprocessing: a stale page cannot mark a new diagnosis as read.
    await transaction.$queryRaw`SELECT id FROM public.notes WHERE id = ${noteId}::uuid FOR UPDATE`;
    const note = await transaction.note.findUnique({ where: { id: noteId },
      select: { version: true, processingStage: true } });
    if (!note) throw new NoteReadError("NOTA_NAO_ENCONTRADA", "Nota não encontrada.", 404);
    if (expectedVersion !== undefined && note.version !== expectedVersion) {
      throw new NoteReadError("ANALISE_ALTERADA", "A análise mudou. Atualize a página antes de marcar como lida.", 409);
    }
    if (note.processingStage !== "COMPLETED" && note.processingStage !== "FAILED") {
      throw new NoteReadError("ANALISE_EM_ANDAMENTO", "Aguarde a conclusão da análise antes de marcar como lida.", 409);
    }
    const readAt = new Date();
    await transaction.noteRead.upsert({
      where: { profileId_noteId: { noteId, profileId } },
      create: { noteId, profileId, readAt }, update: { readAt },
    });
    await transaction.notification.updateMany({
      where: { noteId, recipientId: profileId, readAt: null }, data: { readAt },
    });
    return readAt;
  });
}

import "server-only";

import { randomUUID } from "node:crypto";

import { NoteStatus, ProcessingStage } from "@/generated/prisma/enums";
import {
  InvoiceFileValidationError,
  validateInvoiceFile,
} from "@/lib/storage";
import { prisma } from "@/server/db/prisma";
import { NoteUploadError } from "@/server/notes/note-upload-error";
import {
  createInvoiceObjectPath,
  removeInvoiceFile,
  uploadInvoiceFile,
} from "@/server/storage";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapFileValidationError(error: InvoiceFileValidationError) {
  if (error.code === "FILE_TOO_LARGE") {
    return new NoteUploadError(
      "ARQUIVO_MUITO_GRANDE",
      413,
      "O arquivo ultrapassa o limite permitido.",
      { cause: error },
    );
  }

  if (error.code === "EMPTY_FILE") {
    return new NoteUploadError(
      "ARQUIVO_INVALIDO",
      400,
      "O arquivo enviado está vazio.",
      { cause: error },
    );
  }

  return new NoteUploadError(
    "FORMATO_NAO_SUPORTADO",
    415,
    "Envie um arquivo PDF, JPG ou PNG válido.",
    { cause: error },
  );
}

async function markNoteAsFailed(noteId: string, failureCode: string) {
  await prisma.$transaction(async (transaction) => {
    await transaction.note.update({
      where: { id: noteId },
      data: {
        failureCode,
        failureMessage: "Não foi possível armazenar o arquivo original.",
        processingStage: ProcessingStage.FAILED,
        status: NoteStatus.FAILED,
        version: { increment: 1 },
      },
    });

    await transaction.noteEvent.create({
      data: {
        noteId,
        type: "UPLOAD_FAILED",
        fromStatus: NoteStatus.RECEIVED,
        toStatus: NoteStatus.FAILED,
        data: { failureCode },
      },
    });
  });
}

export async function createNoteUpload(input: {
  bytes: ArrayBuffer | Uint8Array;
  contentType: string;
  fileName: string;
  workId: string;
}) {
  if (!UUID_PATTERN.test(input.workId)) {
    throw new NoteUploadError(
      "OBRA_INVALIDA",
      400,
      "Selecione uma obra válida.",
    );
  }

  let file;

  try {
    file = validateInvoiceFile({
      bytes: input.bytes,
      contentType: input.contentType,
      fileName: input.fileName,
    });
  } catch (error) {
    if (error instanceof InvoiceFileValidationError) {
      throw mapFileValidationError(error);
    }

    throw error;
  }

  const noteId = randomUUID();
  const path = createInvoiceObjectPath({
    extension: file.extension,
    noteId,
    workId: input.workId,
  });
  const { work } = await prisma.$transaction(async (transaction) => {
    const work = await transaction.work.findFirst({
      where: { id: input.workId, active: true },
      select: { id: true, name: true },
    });

    if (!work) {
      throw new NoteUploadError(
        "OBRA_INDISPONIVEL",
        404,
        "A obra selecionada não está disponível para envio.",
      );
    }

    const note = await transaction.note.create({
      data: {
        id: noteId,
        workId: work.id,
        originalFilePath: path,
        originalFileName: file.originalFileName,
        originalMimeType: file.mimeType,
        originalSizeBytes: BigInt(file.size),
        processingStage: ProcessingStage.RECEIVED,
        status: NoteStatus.RECEIVED,
      },
      select: { receivedAt: true },
    });

    await transaction.noteEvent.create({
      data: {
        noteId,
        type: "UPLOAD_RECEIVED",
        toStatus: NoteStatus.RECEIVED,
        data: {
          contentType: file.mimeType,
          fileName: file.originalFileName,
          size: file.size,
        },
      },
    });

    return { note, work };
  });

  try {
    await uploadInvoiceFile({
      bytes: file.bytes,
      contentType: file.mimeType,
      fileName: file.originalFileName,
      noteId,
      path,
      workId: work.id,
    });
  } catch (error) {
    try {
      await removeInvoiceFile(path);
    } catch (compensationError) {
      console.error("Failed to clean up an ambiguous Storage upload", {
        compensationError,
        noteId,
        path,
      });
    }

    try {
      await markNoteAsFailed(noteId, "STORAGE_UPLOAD_FAILED");
    } catch (compensationError) {
      console.error("Failed to record upload compensation", {
        compensationError,
        noteId,
      });
    }

    throw new NoteUploadError(
      "UPLOAD_INDISPONIVEL",
      502,
      "Não foi possível receber o arquivo agora. Tente novamente.",
      { cause: error },
    );
  }

  try {
    const note = await prisma.$transaction(async (transaction) => {
      const updatedNote = await transaction.note.update({
        where: { id: noteId },
        data: {
          failureCode: null,
          failureMessage: null,
          version: { increment: 1 },
        },
        select: { id: true, status: true },
      });

      await transaction.noteEvent.create({
        data: {
          noteId,
          type: "FILE_STORED",
          fromStatus: NoteStatus.RECEIVED,
          toStatus: NoteStatus.RECEIVED,
          data: { path },
        },
      });

      return updatedNote;
    });

    return note;
  } catch (error) {
    try {
      await removeInvoiceFile(path);
    } catch (compensationError) {
      console.error("Failed to remove orphaned invoice object", {
        compensationError,
        noteId,
        path,
      });
    }

    try {
      await markNoteAsFailed(noteId, "UPLOAD_FINALIZATION_FAILED");
    } catch (compensationError) {
      console.error("Failed to record upload finalization compensation", {
        compensationError,
        noteId,
      });
    }

    throw new NoteUploadError(
      "UPLOAD_INDISPONIVEL",
      500,
      "O arquivo foi recebido, mas o envio não pôde ser concluído.",
      { cause: error },
    );
  }
}

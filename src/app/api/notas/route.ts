import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";

import { NOTE_UPLOAD_FIELDS } from "@/lib/notes/upload-contract";
import { getInvoiceStorageConfig } from "@/lib/storage";
import { createNoteUpload } from "@/server/notes/create-note-upload";
import { NoteUploadError } from "@/server/notes/note-upload-error";
import { processProcessingJob } from "@/server/notes/processing-jobs";

export const runtime = "nodejs";

const MULTIPART_OVERHEAD_LIMIT_BYTES = 1024 * 1024;

function errorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string,
) {
  return NextResponse.json(
    { erro: { codigo: code, mensagem: message } },
    { status, headers: { "X-Request-Id": requestId } },
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return errorResponse(
      "FORMATO_DA_REQUISICAO_INVALIDO",
      "Envie obraId e arquivo usando multipart/form-data.",
      415,
      requestId,
    );
  }

  const { maxFileSizeBytes } = getInvoiceStorageConfig();
  const contentLength = Number(request.headers.get("content-length"));

  if (
    Number.isFinite(contentLength) &&
    contentLength > maxFileSizeBytes + MULTIPART_OVERHEAD_LIMIT_BYTES
  ) {
    return errorResponse(
      "ARQUIVO_MUITO_GRANDE",
      "O arquivo ultrapassa o limite permitido.",
      413,
      requestId,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "FORMULARIO_INVALIDO",
      "Não foi possível ler os dados enviados.",
      400,
      requestId,
    );
  }

  const workId = formData.get(NOTE_UPLOAD_FIELDS.workId);
  const file = formData.get(NOTE_UPLOAD_FIELDS.file);

  if (typeof workId !== "string" || workId.trim() === "") {
    return errorResponse(
      "OBRA_INVALIDA",
      "Selecione uma obra válida.",
      400,
      requestId,
    );
  }

  if (!(file instanceof File)) {
    return errorResponse(
      "ARQUIVO_NAO_INFORMADO",
      "Selecione uma nota fiscal para enviar.",
      400,
      requestId,
    );
  }

  if (file.size > maxFileSizeBytes) {
    return errorResponse(
      "ARQUIVO_MUITO_GRANDE",
      "O arquivo ultrapassa o limite permitido.",
      413,
      requestId,
    );
  }

  try {
    const note = await createNoteUpload({
      bytes: await file.arrayBuffer(),
      contentType: file.type,
      fileName: file.name,
      workId: workId.trim(),
    });

    after(async () => {
      try {
        await processProcessingJob(note.processingJobId, {
          workerId: `upload:${requestId}`,
        });
      } catch (error) {
        console.error("Background note processing failed", {
          jobId: note.processingJobId,
          message: error instanceof Error ? error.message : "unknown error",
          noteId: note.id,
          requestId,
        });
      }
    });

    return NextResponse.json(
      {
        nota: {
          id: note.id,
          jobId: note.processingJobId,
          status: note.status,
        },
      },
      {
        status: 201,
        headers: {
          Location: `/api/notas/${note.id}/status`,
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (error) {
    if (error instanceof NoteUploadError) {
      return errorResponse(
        error.code,
        error.message,
        error.httpStatus,
        requestId,
      );
    }

    console.error("Unexpected public note upload failure", { error, requestId });

    return errorResponse(
      "ERRO_INTERNO",
      "Não foi possível concluir o envio.",
      500,
      requestId,
    );
  }
}

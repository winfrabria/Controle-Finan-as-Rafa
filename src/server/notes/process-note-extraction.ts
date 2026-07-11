import "server-only";

import { NoteStatus, ProcessingStage } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceExtraction } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import {
  getOpenRouterInvoiceExtractionClient,
  type InvoiceExtractionClient,
  OpenRouterClientError,
} from "@/server/integrations/openrouter";
import { createInvoiceSignedUrl } from "@/server/storage";

const SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const);

export type ExtractionPipelineErrorCode =
  | "EXTRACTION_CONFLICT"
  | "EXTRACTION_INVALID_RESPONSE"
  | "EXTRACTION_NOT_ALLOWED"
  | "EXTRACTION_PROVIDER_ERROR"
  | "EXTRACTION_SOURCE_UNAVAILABLE"
  | "EXTRACTION_TIMEOUT"
  | "NOTE_NOT_FOUND";

export class ExtractionPipelineError extends Error {
  constructor(
    public readonly code: ExtractionPipelineErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExtractionPipelineError";
  }
}

function isRetryableFailedNote(failureCode: string | null) {
  return failureCode?.startsWith("EXTRACTION_") ?? false;
}

function getFailureDetails(error: unknown): {
  code: ExtractionPipelineErrorCode;
  message: string;
} {
  if (error instanceof OpenRouterClientError) {
    if (error.kind === "timeout") {
      return {
        code: "EXTRACTION_TIMEOUT",
        message: "A extração excedeu o tempo limite.",
      };
    }

    if (error.kind === "invalid-response") {
      return {
        code: "EXTRACTION_INVALID_RESPONSE",
        message: "A resposta de extração não pôde ser validada.",
      };
    }

    return {
      code: "EXTRACTION_PROVIDER_ERROR",
      message: "O serviço de extração está temporariamente indisponível.",
    };
  }

  return {
    code: "EXTRACTION_SOURCE_UNAVAILABLE",
    message: "O arquivo original não pôde ser acessado para extração.",
  };
}

async function claimNote(noteId: string) {
  return prisma.$transaction(async (transaction) => {
    const note = await transaction.note.findUnique({
      where: { id: noteId },
      select: {
        failureCode: true,
        id: true,
        originalFileName: true,
        originalFilePath: true,
        originalMimeType: true,
        status: true,
        version: true,
      },
    });

    if (!note) {
      throw new ExtractionPipelineError(
        "NOTE_NOT_FOUND",
        "Nota não encontrada.",
      );
    }

    const canProcess =
      note.status === NoteStatus.RECEIVED ||
      (note.status === NoteStatus.FAILED &&
        isRetryableFailedNote(note.failureCode));

    if (!canProcess) {
      throw new ExtractionPipelineError(
        note.status === NoteStatus.PROCESSING
          ? "EXTRACTION_CONFLICT"
          : "EXTRACTION_NOT_ALLOWED",
        "A nota não está disponível para extração.",
      );
    }

    const claimed = await transaction.note.updateMany({
      where: { id: note.id, status: note.status, version: note.version },
      data: {
        failureCode: null,
        failureMessage: null,
        processingStage: ProcessingStage.EXTRACTING,
        status: NoteStatus.PROCESSING,
        version: { increment: 1 },
      },
    });

    if (claimed.count !== 1) {
      throw new ExtractionPipelineError(
        "EXTRACTION_CONFLICT",
        "A nota já foi atualizada por outro processo.",
      );
    }

    await transaction.noteEvent.create({
      data: {
        noteId: note.id,
        type: "EXTRACTION_STARTED",
        fromStatus: note.status,
        toStatus: NoteStatus.PROCESSING,
      },
    });

    return { ...note, claimedVersion: note.version + 1 };
  });
}

async function recordExtractionFailure(
  noteId: string,
  claimedVersion: number,
  failure: { code: ExtractionPipelineErrorCode; message: string },
) {
  await prisma.$transaction(async (transaction) => {
    const failed = await transaction.note.updateMany({
      where: {
        id: noteId,
        processingStage: ProcessingStage.EXTRACTING,
        status: NoteStatus.PROCESSING,
        version: claimedVersion,
      },
      data: {
        failureCode: failure.code,
        failureMessage: failure.message,
        processingStage: ProcessingStage.FAILED,
        status: NoteStatus.FAILED,
        version: { increment: 1 },
      },
    });

    if (failed.count === 1) {
      await transaction.noteEvent.create({
        data: {
          noteId,
          type: "EXTRACTION_FAILED",
          fromStatus: NoteStatus.PROCESSING,
          toStatus: NoteStatus.FAILED,
          data: { failureCode: failure.code },
        },
      });
    }
  });
}

function toJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

async function persistExtraction(input: {
  attempts: number;
  claimedVersion: number;
  extraction: InvoiceExtraction;
  model: string;
  noteId: string;
  provider?: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.note.updateMany({
      where: {
        id: input.noteId,
        processingStage: ProcessingStage.EXTRACTING,
        status: NoteStatus.PROCESSING,
        version: input.claimedVersion,
      },
      data: {
        documentNumber: input.extraction.documentNumber,
        extractedData: toJsonValue(input.extraction),
        extractionMarkdown: input.extraction.markdown,
        issuedAt: input.extraction.issuedAt
          ? new Date(`${input.extraction.issuedAt}T00:00:00.000Z`)
          : null,
        processingStage: ProcessingStage.ANALYZING,
        readConfidence: input.extraction.readConfidence,
        supplierName: input.extraction.supplierName,
        supplierTaxId: input.extraction.supplierTaxId,
        totalAmount: input.extraction.totalAmount,
        version: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new ExtractionPipelineError(
        "EXTRACTION_CONFLICT",
        "A nota mudou durante a extração.",
      );
    }

    await transaction.noteItem.deleteMany({ where: { noteId: input.noteId } });

    if (input.extraction.items.length > 0) {
      await transaction.noteItem.createMany({
        data: input.extraction.items.map((item) => ({
          noteId: input.noteId,
          lineNumber: item.lineNumber,
          code: item.code,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          rawData: toJsonValue(item),
        })),
      });
    }

    await transaction.noteEvent.create({
      data: {
        noteId: input.noteId,
        type: "EXTRACTION_COMPLETED",
        fromStatus: NoteStatus.PROCESSING,
        toStatus: NoteStatus.PROCESSING,
        data: {
          attempts: input.attempts,
          itemCount: input.extraction.items.length,
          model: input.model,
          provider: input.provider ?? null,
          readConfidence: input.extraction.readConfidence,
        },
      },
    });

    return {
      id: input.noteId,
      itemCount: input.extraction.items.length,
      processingStage: ProcessingStage.ANALYZING,
      readConfidence: input.extraction.readConfidence,
      status: NoteStatus.PROCESSING,
    } as const;
  });
}

export async function processNoteExtraction(
  noteId: string,
  dependencies: { client?: InvoiceExtractionClient } = {},
) {
  const note = await claimNote(noteId);

  try {
    if (!SUPPORTED_MIME_TYPES.has(note.originalMimeType)) {
      throw new ExtractionPipelineError(
        "EXTRACTION_SOURCE_UNAVAILABLE",
        "O tipo do arquivo original não é suportado.",
      );
    }

    const { signedUrl } = await createInvoiceSignedUrl({
      path: note.originalFilePath,
      expiresInSeconds: 30 * 60,
    });
    const client =
      dependencies.client ?? getOpenRouterInvoiceExtractionClient();
    const result = await client.extractInvoice({
      fileName: note.originalFileName,
      mimeType: note.originalMimeType as
        | "application/pdf"
        | "image/jpeg"
        | "image/png",
      signedUrl,
    });

    return await persistExtraction({
      attempts: result.attempts,
      claimedVersion: note.claimedVersion,
      extraction: result.data,
      model: result.model,
      noteId: note.id,
      provider: result.provider,
    });
  } catch (error) {
    if (error instanceof ExtractionPipelineError && error.code === "EXTRACTION_CONFLICT") {
      throw error;
    }

    const failure =
      error instanceof ExtractionPipelineError
        ? { code: error.code, message: error.message }
        : getFailureDetails(error);

    await recordExtractionFailure(note.id, note.claimedVersion, failure);

    throw new ExtractionPipelineError(failure.code, failure.message, {
      cause: error,
    });
  }
}

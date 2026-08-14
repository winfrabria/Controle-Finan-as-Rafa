import "server-only";

import { createHash } from "node:crypto";

import {
  AiRunKind,
  AiRunStatus,
  NoteStatus,
  ProcessingStage,
  ReasoningEffort,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  HARNESS_MODEL,
  HARNESS_VERSIONS,
  resolveAuditReasoningEffort,
  resolveHarnessModel,
  resolvePdfModel,
} from "@/lib/audit-harness";
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
  | "EXTRACTION_CREDIT_EXHAUSTED"
  | "EXTRACTION_INVALID_RESPONSE"
  | "EXTRACTION_NOT_ALLOWED"
  | "EXTRACTION_PROVIDER_ERROR"
  | "EXTRACTION_REQUEST_REJECTED"
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

type ExtractionFailureDetails = {
  code: ExtractionPipelineErrorCode;
  diagnostic?: string;
  message: string;
  providerStatus?: number;
  retryable?: boolean;
};

function getFailureDetails(error: unknown): ExtractionFailureDetails {
  if (error instanceof OpenRouterClientError) {
    const providerDetails = {
      diagnostic: error.diagnostic,
      providerStatus: error.status,
      retryable: error.retryable,
    };
    if (error.kind === "timeout") {
      return {
        code: "EXTRACTION_TIMEOUT",
        message: "A extração excedeu o tempo limite.",
        ...providerDetails,
      };
    }

    if (error.kind === "invalid-response") {
      return {
        code: "EXTRACTION_INVALID_RESPONSE",
        message: "A resposta de extração não pôde ser validada.",
        ...providerDetails,
      };
    }

    if (error.status === 402) {
      return {
        code: "EXTRACTION_CREDIT_EXHAUSTED",
        message: "Os créditos do provedor de IA são insuficientes para processar o anexo.",
        ...providerDetails,
        diagnostic: "provider-payment-required",
      };
    }

    if (!error.retryable) {
      return {
        code: "EXTRACTION_REQUEST_REJECTED",
        message: "O provedor recusou a configuração da extração.",
        ...providerDetails,
      };
    }

    return {
      code: "EXTRACTION_PROVIDER_ERROR",
      message: "O serviço de extração está temporariamente indisponível.",
      ...providerDetails,
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
        processingStage: true,
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
        isRetryableFailedNote(note.failureCode)) ||
      (note.status === NoteStatus.PROCESSING &&
        note.processingStage === ProcessingStage.EXTRACTING &&
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
        processingStage: ProcessingStage.EXTRACTING,
        status: NoteStatus.PROCESSING,
        version: { increment: 1 },
      },
    });

    if (failed.count === 1) {
      await transaction.noteEvent.create({
        data: {
          noteId,
          type: "EXTRACTION_ATTEMPT_FAILED",
          fromStatus: NoteStatus.PROCESSING,
          toStatus: NoteStatus.PROCESSING,
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
  aiRunId: string;
  attempts: number;
  claimedVersion: number;
  extraction: InvoiceExtraction;
  model: string;
  noteId: string;
  provider?: string;
  usage?: {
    completionTokens?: number;
    costUsd?: number;
    promptTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
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

    await transaction.aiRun.update({
      where: { id: input.aiRunId },
      data: {
        attempts: input.attempts,
        completionTokens: input.usage?.completionTokens,
        completedAt: new Date(),
        costUsd: input.usage?.costUsd,
        latencyMs: input.latencyMs,
        model: input.model,
        promptTokens: input.usage?.promptTokens,
        provider: input.provider,
        status: AiRunStatus.SUCCEEDED,
        structuredResponse: toJsonValue({
          documentNumber: input.extraction.documentNumber,
          itemCoverage: input.extraction.itemCoverage,
          itemCount: input.extraction.items.length,
          readConfidence: input.extraction.readConfidence,
          warnings: input.extraction.warnings,
        }),
        totalTokens: input.usage?.totalTokens,
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
  dependencies: { client?: InvoiceExtractionClient; processingJobId?: string } = {},
) {
  const note = await claimNote(noteId);
  const extractingPdf = note.originalMimeType === "application/pdf";
  const configuredReasoning = resolveAuditReasoningEffort(
    extractingPdf
      ? process.env.OPENROUTER_PDF_REASONING_EFFORT
      : process.env.OPENROUTER_EXTRACTION_REASONING_EFFORT,
    "max",
  );
  const idempotencyKey = `extract:${dependencies.processingJobId ?? note.id}:${note.claimedVersion}`;
  const aiRun = await prisma.aiRun.create({
    data: {
      idempotencyKey,
      kind: AiRunKind.EXTRACTION,
      model: extractingPdf
        ? resolvePdfModel(process.env.OPENROUTER_PDF_MODEL)
        : resolveHarnessModel(process.env.OPENROUTER_EXTRACTION_MODEL, HARNESS_MODEL),
      noteId: note.id,
      policyVersion: HARNESS_VERSIONS.policy,
      processingJobId: dependencies.processingJobId,
      promptVersion: HARNESS_VERSIONS.prompt,
      reasoningEffort:
        configuredReasoning === "xhigh"
          ? ReasoningEffort.XHIGH
          : configuredReasoning === "high"
            ? ReasoningEffort.HIGH
            : ReasoningEffort.MAX,
      requestFingerprint: createHash("sha256")
        .update(`${note.id}:${note.claimedVersion}:${note.originalFileName}`)
        .digest("hex"),
      schemaVersion: HARNESS_VERSIONS.schema,
      status: AiRunStatus.RUNNING,
    },
    select: { id: true },
  });

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
      aiRunId: aiRun.id,
      attempts: result.attempts,
      claimedVersion: note.claimedVersion,
      extraction: result.data,
      model: result.model,
      noteId: note.id,
      provider: result.provider,
      usage: result.usage,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    if (error instanceof ExtractionPipelineError && error.code === "EXTRACTION_CONFLICT") {
      throw error;
    }

    const failure: ExtractionFailureDetails =
      error instanceof ExtractionPipelineError
        ? { code: error.code, message: error.message }
        : getFailureDetails(error);

    await recordExtractionFailure(note.id, note.claimedVersion, failure);
    await prisma.aiRun.update({
      where: { id: aiRun.id },
      data: {
        completedAt: new Date(),
        errorCode: failure.code,
        errorMessage: failure.message,
        status: AiRunStatus.FAILED,
        ...(failure.diagnostic || failure.providerStatus
          ? {
              structuredResponse: toJsonValue({
                diagnostic: failure.diagnostic ?? null,
                providerStatus: failure.providerStatus ?? null,
                retryable: failure.retryable ?? null,
              }),
            }
          : {}),
      },
    });

    throw new ExtractionPipelineError(failure.code, failure.message, {
      cause: error,
    });
  }
}

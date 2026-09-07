import "server-only";

import { createHash } from "node:crypto";

import {
  AiRunKind,
  AiRunStatus,
  NoteStatus,
  ProcessingStage,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  HARNESS_VERSIONS,
  resolveHarnessVerifierMode,
} from "@/lib/audit-harness";
import type { InvoiceExtraction } from "@/lib/integrations/openrouter/extraction-contract";
import { extractionReasoningStorage, type ExtractionReasoningEffort } from "@/lib/integrations/openrouter/extraction-reasoning";
import { getOpenRouterConfig } from "@/server/integrations/openrouter/config";
import { prisma } from "@/server/db/prisma";
import {
  getOpenRouterInvoiceExtractionClient,
  isInvoiceExtractionLimitationDiagnostic,
  type InvoiceExtractionAttempt,
  type InvoiceExtractionClient,
  type InvoiceExtractionQualityLimitation,
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
  | "EXTRACTION_CONFIGURATION_INVALID"
  | "EXTRACTION_CREDIT_EXHAUSTED"
  | "EXTRACTION_DOCUMENT_UNREADABLE"
  | "EXTRACTION_INCOMPLETE"
  | "EXTRACTION_INVALID_RESPONSE"
  | "EXTRACTION_NOT_ALLOWED"
  | "EXTRACTION_PROVIDER_ERROR"
  | "EXTRACTION_PERSISTENCE_FAILED"
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

export type ExtractionFailureCategory =
  | "PROVIDER"
  | "CONFIGURATION"
  | "TIMEOUT"
  | "EXTRACTION_INCOMPLETE"
  | "DOCUMENT_UNREADABLE"
  | "PERSISTENCE";

function isRetryableFailedNote(failureCode: string | null) {
  return failureCode?.startsWith("EXTRACTION_") ?? false;
}

type ExtractionFailureDetails = {
  attemptTrace?: InvoiceExtractionAttempt[];
  attempts?: number;
  code: ExtractionPipelineErrorCode;
  category: ExtractionFailureCategory;
  completionTokens?: number;
  costUsd?: number;
  diagnostic?: string;
  diagnosticDetails?: Record<string, unknown>;
  latencyMs?: number;
  message: string;
  model?: string;
  promptTokens?: number;
  provider?: string;
  providerStatus?: number;
  requestId?: string;
  retryable?: boolean;
  routingMetadata?: Record<string, string | number | boolean | null>;
  totalTokens?: number;
};

function getFailureDetails(error: unknown, stage: "PERSISTENCE" | "SOURCE" | "PROVIDER"): ExtractionFailureDetails {
  if (error instanceof OpenRouterClientError) {
    const providerDetails = {
      attemptTrace: error.attemptTrace,
      attempts: error.attempts,
      completionTokens: error.usage?.completionTokens,
      costUsd: error.usage?.costUsd,
      diagnostic: error.diagnostic,
      diagnosticDetails: error.diagnosticDetails,
      latencyMs: error.latencyMs,
      model: error.model,
      promptTokens: error.usage?.promptTokens,
      provider: error.provider,
      providerStatus: error.status,
      requestId: error.requestId,
      retryable: error.retryable,
      routingMetadata: error.routingMetadata,
      totalTokens: error.usage?.totalTokens,
    };
    if (error.kind === "timeout") {
      return {
        code: "EXTRACTION_TIMEOUT",
        category: "TIMEOUT",
        message: "A extração excedeu o tempo limite.",
        ...providerDetails,
      };
    }

    if (
      error.kind === "invalid-response" &&
      isInvoiceExtractionLimitationDiagnostic(error.diagnostic)
    ) {
      return {
        code: "EXTRACTION_INCOMPLETE",
        category: "EXTRACTION_INCOMPLETE",
        message:
          "A extração não cobriu o anexo integralmente; uma nova leitura é necessária.",
        ...providerDetails,
      };
    }

    if (error.diagnostic === "document-unreadable") {
      return {
        code: "EXTRACTION_DOCUMENT_UNREADABLE",
        category: "DOCUMENT_UNREADABLE",
        message:
          "O arquivo está vazio, corrompido, criptografado ou protegido e não pôde ser lido.",
        ...providerDetails,
      };
    }

    if (error.diagnostic === "pdf-parser-rejected") {
      return { ...providerDetails, code: "EXTRACTION_PROVIDER_ERROR", category: "PROVIDER",
        message: "O serviço de leitura não conseguiu interpretar o PDF. Isso não comprova que o arquivo esteja corrompido ou protegido." };
    }

    if (error.kind === "invalid-response") {
      return {
        code: "EXTRACTION_INVALID_RESPONSE",
        category: "EXTRACTION_INCOMPLETE",
        message: "A resposta de extração não pôde ser validada.",
        ...providerDetails,
      };
    }

    if (error.status === 402) {
      return {
        code: "EXTRACTION_CREDIT_EXHAUSTED",
        category: "PROVIDER",
        message: "Os créditos do provedor de IA são insuficientes para processar o anexo.",
        ...providerDetails,
        diagnostic: "provider-payment-required",
      };
    }

    if (!error.retryable) {
      return {
        code: "EXTRACTION_REQUEST_REJECTED",
        category: "CONFIGURATION",
        message: "O provedor recusou a configuração da extração.",
        ...providerDetails,
      };
    }

    return {
      code: "EXTRACTION_PROVIDER_ERROR",
      category: "PROVIDER",
      message: "O serviço de extração está temporariamente indisponível.",
      ...providerDetails,
    };
  }

  if (stage === "PERSISTENCE") return {
    code: "EXTRACTION_PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    message: "Não foi possível registrar o resultado da extração. Tente novamente pelo painel administrativo.",
  };
  if (stage === "PROVIDER") return {
    code: "EXTRACTION_PROVIDER_ERROR",
    category: "PROVIDER",
    message: "O serviço de extração está temporariamente indisponível.",
  };
  return {
    code: "EXTRACTION_SOURCE_UNAVAILABLE",
    category: "PROVIDER",
    message: "O arquivo original não pôde ser acessado para extração.",
  };
}

async function claimNote(noteId: string, processingJobId?: string) {
  return prisma.$transaction(async (transaction) => {
    const note = await transaction.note.findUnique({
      where: { id: noteId },
      select: {
        failureCode: true,
        id: true,
        originalFileName: true,
        originalFilePath: true,
        originalMimeType: true,
        originalPageCount: true,
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

    // A generic pre-extraction interruption can be retried only by the durable
    // job that currently owns this note. Never relax claims for a second caller.
    const genericRecoveryJob = note.failureCode === "PIPELINE_FAILED" && processingJobId
      ? await transaction.processingJob.findFirst({ where: {
          id: processingJobId, noteId, status: "RUNNING", type: "FULL_AUDIT",
        }, select: { id: true } })
      : null;
    const retryable = isRetryableFailedNote(note.failureCode) || Boolean(genericRecoveryJob);
    const canProcess =
      note.status === NoteStatus.RECEIVED ||
      (note.status === NoteStatus.FAILED &&
        retryable) ||
      (note.status === NoteStatus.PROCESSING &&
        note.processingStage === ProcessingStage.EXTRACTING &&
        retryable);

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
  failure: {
    category: ExtractionFailureCategory;
    code: ExtractionPipelineErrorCode;
    message: string;
  },
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
          data: {
            failureCategory: failure.category,
            failureCode: failure.code,
          },
        },
      });
    }
  });
}

function toJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

async function persistExtraction(input: {
  extractionReasoningEffort: ExtractionReasoningEffort;
  aiRunId: string;
  attemptTrace: InvoiceExtractionAttempt[];
  attempts: number;
  claimedVersion: number;
  extraction: InvoiceExtraction;
  model: string;
  noteId: string;
  provider?: string;
  qualityLimitation?: InvoiceExtractionQualityLimitation;
  requestId?: string;
  routingMetadata?: Record<string, string | number | boolean | null>;
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
        data: toJsonValue({
          attempts: input.attempts,
          attemptTrace: input.attemptTrace,
          itemCount: input.extraction.items.length,
          model: input.model,
          provider: input.provider ?? null,
          requestId: input.requestId ?? null,
          readConfidence: input.extraction.readConfidence,
          qualityLimitation: input.qualityLimitation
            ? toJsonValue(input.qualityLimitation)
            : null,
        }),
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
          extractionReasoningEffort: input.extractionReasoningEffort,
          documentNumber: input.extraction.documentNumber,
          itemCoverage: input.extraction.itemCoverage,
          itemCount: input.extraction.items.length,
          readConfidence: input.extraction.readConfidence,
          warnings: input.extraction.warnings,
          qualityLimitation: input.qualityLimitation ?? null,
          attemptTrace: input.attemptTrace,
          requestId: input.requestId ?? null,
          routing: input.routingMetadata ?? null,
          extractionQuality:
            !input.qualityLimitation && input.extraction.itemCoverage.status === "COMPLETE"
              ? "COMPLETE"
              : "EXTRACTION_INCOMPLETE",
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
  // Validate configuration before claiming the note or doing paid work. A bad
  // environment is terminal for this job, not a reason to replay extraction.
  let config: ReturnType<typeof getOpenRouterConfig>;
  try {
    config = getOpenRouterConfig(process.env, "extraction");
    getOpenRouterConfig(process.env, "audit");
    const verifierMode = resolveHarnessVerifierMode(process.env.HARNESS_VERIFIER_MODE, process.env.HARNESS_VERIFIER_GATE_APPROVED);
    if (verifierMode !== "off") getOpenRouterConfig(process.env, "verification");
  } catch (error) {
    throw new ExtractionPipelineError("EXTRACTION_CONFIGURATION_INVALID",
      "A configuração de IA é inválida. Revise modelo e esforço de extração/auditoria no ambiente.",
      { cause: error });
  }
  const note = await claimNote(noteId, dependencies.processingJobId);
  const extractingPdf = note.originalMimeType === "application/pdf";
  const configuredReasoning = (extractingPdf ? config.pdfReasoningEffort : config.reasoningEffort) as ExtractionReasoningEffort;
  let aiRun: { id: string } | undefined;
  let failureStage: "PERSISTENCE" | "SOURCE" | "PROVIDER" = "PERSISTENCE";
  try {
    const idempotencyKey = `extract:${dependencies.processingJobId ?? note.id}:${note.claimedVersion}`;
    aiRun = await prisma.aiRun.create({
      data: {
        idempotencyKey,
        kind: AiRunKind.EXTRACTION,
        model: extractingPdf ? config.pdfModel! : config.model,
        noteId: note.id,
        policyVersion: HARNESS_VERSIONS.policy,
        processingJobId: dependencies.processingJobId,
        promptVersion: HARNESS_VERSIONS.prompt,
        reasoningEffort: extractionReasoningStorage(configuredReasoning),
        structuredResponse: { extractionReasoningEffort: configuredReasoning },
        requestFingerprint: createHash("sha256")
          .update(`${note.id}:${note.claimedVersion}:${note.originalFileName}`)
          .digest("hex"),
        schemaVersion: HARNESS_VERSIONS.schema,
        status: AiRunStatus.RUNNING,
      },
      select: { id: true },
    });

    if (!SUPPORTED_MIME_TYPES.has(note.originalMimeType)) {
      throw new ExtractionPipelineError(
        "EXTRACTION_SOURCE_UNAVAILABLE",
        "O tipo do arquivo original não é suportado.",
      );
    }

    failureStage = "SOURCE";
    const { signedUrl } = await createInvoiceSignedUrl({
      path: note.originalFilePath,
      expiresInSeconds: 30 * 60,
    });
    failureStage = "PROVIDER";
    const client =
      dependencies.client ?? getOpenRouterInvoiceExtractionClient();
    const result = await client.extractInvoice({
      fileName: note.originalFileName,
      mimeType: note.originalMimeType as
        | "application/pdf"
        | "image/jpeg"
        | "image/png",
      signedUrl,
      pageCount: extractingPdf ? note.originalPageCount : 1,
    });

    failureStage = "PERSISTENCE";
    return await persistExtraction({
      extractionReasoningEffort: result.model === (extractingPdf ? config.pdfModel : config.model)
        ? configuredReasoning : config.extractionFallbackReasoningEffort ?? "high",
      aiRunId: aiRun.id,
      attempts: result.attempts,
      attemptTrace: result.attemptTrace ?? [],
      claimedVersion: note.claimedVersion,
      extraction: result.data,
      model: result.model,
      noteId: note.id,
      provider: result.provider,
      qualityLimitation: result.qualityLimitation,
      requestId: result.requestId,
      routingMetadata: result.routingMetadata,
      usage: result.usage,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    if (error instanceof ExtractionPipelineError && error.code === "EXTRACTION_CONFLICT") {
      throw error;
    }

    const failure: ExtractionFailureDetails =
      error instanceof ExtractionPipelineError
        ? {
            category: "PROVIDER",
            code: error.code,
            message: error.message,
          }
        : getFailureDetails(error, failureStage);

    await recordExtractionFailure(note.id, note.claimedVersion, failure);
    const hasFailureDiagnostics = Boolean(
      failure.category ||
        failure.diagnostic ||
        failure.diagnosticDetails ||
        failure.providerStatus ||
        failure.requestId ||
        failure.routingMetadata ||
        failure.attemptTrace,
    );
    if (aiRun) await prisma.aiRun.update({
      where: { id: aiRun.id },
      data: {
        attempts: failure.attempts,
        completionTokens: failure.completionTokens,
        completedAt: new Date(),
        costUsd: failure.costUsd,
        errorCode: failure.code,
        errorMessage: failure.message,
        latencyMs: failure.latencyMs,
        model: failure.model,
        promptTokens: failure.promptTokens,
        provider: failure.provider,
        status: AiRunStatus.FAILED,
        ...(hasFailureDiagnostics
          ? {
              structuredResponse: toJsonValue({
                extractionReasoningEffort: (failure.attempts ?? 1) > 1
                  ? config.extractionFallbackReasoningEffort ?? "high" : configuredReasoning,
                category: failure.category,
                attemptTrace: failure.attemptTrace ?? [],
                diagnostic: failure.diagnostic ?? null,
                details: failure.diagnosticDetails ?? null,
                providerStatus: failure.providerStatus ?? null,
                requestId: failure.requestId ?? null,
                retryable: failure.retryable ?? null,
                routing: failure.routingMetadata ?? null,
              }),
            }
          : {}),
        totalTokens: failure.totalTokens,
      },
    });

    throw new ExtractionPipelineError(failure.code, failure.message, {
      cause: error,
    });
  }
}

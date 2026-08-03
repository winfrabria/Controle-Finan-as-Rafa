import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  ContextSubmissionStatus,
  FindingStatus,
  NoteStatus,
  ProcessingJobStatus,
  ProcessingJobType,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import {
  revokedPublicCapabilityFields,
  terminalPublicCapabilityFields,
} from "@/server/notes/public-capability";
import { processNoteAudit } from "./process-note-audit";
import { processNoteExtraction } from "./process-note-extraction";

export class ProcessingJobError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProcessingJobError";
  }
}

export const ACTIVE_CONTEXT_SUBMISSION_STATUSES = [
  ContextSubmissionStatus.SUBMITTED,
  ContextSubmissionStatus.REANALYSIS_QUEUED,
] as const;

export function processingFailureLifecycle(input: {
  attempt: number;
  maxAttempts: number;
  type: ProcessingJobType;
}) {
  const attemptsExhausted = input.attempt >= input.maxAttempts;
  return {
    attemptsExhausted,
    contextSubmissionStatus:
      attemptsExhausted && input.type === ProcessingJobType.CONTEXT_REANALYSIS
        ? ContextSubmissionStatus.REANALYSIS_FAILED
        : null,
    noteStage: attemptsExhausted
      ? ProcessingStage.FAILED
      : input.type === ProcessingJobType.CONTEXT_REANALYSIS
        ? ProcessingStage.ANALYZING
        : ProcessingStage.EXTRACTING,
    noteStatus: attemptsExhausted ? NoteStatus.FAILED : NoteStatus.PROCESSING,
  } as const;
}

function pipelineFailureCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return "PIPELINE_FAILED";
}

export async function createInitialProcessingJob(
  transaction: Prisma.TransactionClient,
  noteId: string,
) {
  return transaction.processingJob.create({
    data: {
      // O upload chama o worker logo após criar o job. Atrasos só devem ser
      // aplicados em retries, nunca no primeiro processamento.
      availableAt: new Date(),
      idempotencyKey: `upload:${noteId}`,
      noteId,
      type: ProcessingJobType.FULL_AUDIT,
    },
    select: { id: true, status: true },
  });
}

export async function claimProcessingJob(jobId: string, workerId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.processingJob.findUnique({
      where: { id: jobId },
      select: {
        attempt: true,
        availableAt: true,
        id: true,
        maxAttempts: true,
        noteId: true,
        status: true,
        type: true,
        contextSubmissionId: true,
      },
    });
    if (!job) throw new ProcessingJobError("JOB_NOT_FOUND", "Job não encontrado.");
    const statusIsClaimable =
      job.status === ProcessingJobStatus.PENDING ||
      job.status === ProcessingJobStatus.FAILED;
    if (
      !statusIsClaimable ||
      job.attempt >= job.maxAttempts ||
      job.availableAt > new Date()
    ) {
      throw new ProcessingJobError("JOB_NOT_CLAIMABLE", "Job indisponível para execução.");
    }

    const claimed = await tx.processingJob.updateMany({
      where: {
        attempt: job.attempt,
        id: job.id,
        status: job.status,
      },
      data: {
        attempt: { increment: 1 },
        lastError: null,
        lastErrorCode: null,
        lockedAt: new Date(),
        lockedBy: workerId,
        startedAt: new Date(),
        status: ProcessingJobStatus.RUNNING,
      },
    });
    if (claimed.count !== 1) {
      throw new ProcessingJobError("JOB_CONFLICT", "Outro worker assumiu o job.");
    }

    return { ...job, attempt: job.attempt + 1, workerId };
  });
}

export async function processProcessingJob(
  jobId: string,
  dependencies: {
    workerId?: string;
    processExtraction?: typeof processNoteExtraction;
    processAudit?: typeof processNoteAudit;
  } = {},
) {
  const workerId = dependencies.workerId ?? `worker:${randomUUID()}`;
  const job = await claimProcessingJob(jobId, workerId);

  try {
    const noteState = await prisma.note.findUniqueOrThrow({
      where: { id: job.noteId },
      select: {
        extractedData: true,
        failureCode: true,
        processingStage: true,
        status: true,
      },
    });
    const retryingAudit =
      Boolean(noteState.extractedData) &&
      (noteState.processingStage === ProcessingStage.ANALYZING ||
        noteState.failureCode?.startsWith("AUDIT_"));
    if (job.type === ProcessingJobType.CONTEXT_REANALYSIS || retryingAudit) {
      await prisma.note.update({
        where: { id: job.noteId },
        data: {
          failureCode: null,
          failureMessage: null,
          processingStage: ProcessingStage.ANALYZING,
          status: NoteStatus.PROCESSING,
          version: { increment: 1 },
        },
      });
    } else {
      await (dependencies.processExtraction ?? processNoteExtraction)(job.noteId, {
        processingJobId: job.id,
      });
    }
    const note = await (dependencies.processAudit ?? processNoteAudit)(job.noteId, {
      contextSubmissionId: job.contextSubmissionId ?? undefined,
      processingJobId: job.id,
    });
    await prisma.processingJob.updateMany({
      where: { id: job.id, lockedBy: workerId, status: ProcessingJobStatus.RUNNING },
      data: {
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        status: ProcessingJobStatus.SUCCEEDED,
      },
    });
    return { jobId: job.id, note };
  } catch (error) {
    const now = new Date();
    const failureCode = pipelineFailureCode(error);
    const lifecycle = processingFailureLifecycle(job);
    await prisma.$transaction(async (tx) => {
      const failedJob = await tx.processingJob.updateMany({
        where: {
          id: job.id,
          lockedBy: workerId,
          status: ProcessingJobStatus.RUNNING,
        },
        data: {
          availableAt: lifecycle.attemptsExhausted
            ? now
            : new Date(
                now.getTime() + Math.min(2 ** job.attempt * 1_000, 60_000),
              ),
          completedAt: lifecycle.attemptsExhausted ? now : null,
          lastError: "O pipeline não pôde ser concluído.",
          lastErrorCode: failureCode,
          lockedAt: null,
          lockedBy: null,
          status: ProcessingJobStatus.FAILED,
        },
      });
      if (failedJob.count !== 1) return;

      const currentNote = await tx.note.findUnique({
        where: { id: job.noteId },
        select: {
          extractedData: true,
          processingStage: true,
          status: true,
        },
      });
      if (!currentNote || currentNote.processingStage === ProcessingStage.COMPLETED) {
        return;
      }

      const retryStage =
        job.type === ProcessingJobType.CONTEXT_REANALYSIS ||
        Boolean(currentNote.extractedData)
          ? ProcessingStage.ANALYZING
          : ProcessingStage.EXTRACTING;
      const noteUpdated = await tx.note.updateMany({
        where: {
          id: job.noteId,
          processingStage: { not: ProcessingStage.COMPLETED },
        },
        data: lifecycle.attemptsExhausted
          ? {
              failureCode: "PROCESSING_ATTEMPTS_EXHAUSTED",
              failureMessage:
                "O anexo não pôde ser processado após as tentativas automáticas.",
              ...terminalPublicCapabilityFields(),
              processingStage: ProcessingStage.FAILED,
              status: NoteStatus.FAILED,
              version: { increment: 1 },
            }
          : {
              failureCode,
              failureMessage:
                "A tentativa falhou e será repetida automaticamente.",
              processingStage: retryStage,
              status: NoteStatus.PROCESSING,
              version: { increment: 1 },
            },
      });
      if (noteUpdated.count !== 1) return;

      if (lifecycle.contextSubmissionStatus && job.contextSubmissionId) {
        await tx.noteContextSubmission.updateMany({
          where: {
            id: job.contextSubmissionId,
            status: {
              in: [...ACTIVE_CONTEXT_SUBMISSION_STATUSES],
            },
          },
          data: {
            reanalysisCompletedAt: now,
            status: lifecycle.contextSubmissionStatus,
          },
        });
      }

      await tx.noteEvent.create({
        data: {
          noteId: job.noteId,
          type: lifecycle.attemptsExhausted
            ? "PROCESSING_ATTEMPTS_EXHAUSTED"
            : "PROCESSING_RETRY_SCHEDULED",
          fromStatus: currentNote.status,
          toStatus: lifecycle.noteStatus,
          data: {
            attempt: job.attempt,
            failureCode,
            jobId: job.id,
            maxAttempts: job.maxAttempts,
            nextAttempt: lifecycle.attemptsExhausted
              ? null
              : job.attempt + 1,
          },
        },
      });
    });
    throw error;
  }
}

export async function scheduleNoteReprocess(noteId: string) {
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        status: true,
        version: true,
      },
    });
    if (!note) throw new ProcessingJobError("NOTE_NOT_FOUND", "Nota não encontrada.");

    // Keep these reads explicitly sequential inside the interactive transaction.
    // A relation-heavy `findUnique` is compiled into parallel driver queries by
    // Prisma and makes node-postgres execute more than one query on the same
    // transaction client, which is deprecated in pg 8 and will fail in pg 9.
    const activeJob = await tx.processingJob.findFirst({
      where: {
        noteId,
        status: {
          in: [ProcessingJobStatus.PENDING, ProcessingJobStatus.RUNNING],
        },
      },
      select: { id: true },
    });
    const latestQuestion = await tx.noteContextQuestion.findFirst({
      where: { noteId },
      orderBy: { round: "desc" },
      select: { round: true },
    });
    const activeSubmission = await tx.noteContextSubmission.findFirst({
      where: {
        noteId,
        status: { in: [...ACTIVE_CONTEXT_SUBMISSION_STATUSES] },
      },
      select: { id: true },
    });

    if (
      activeJob ||
      activeSubmission ||
      note.status === NoteStatus.PROCESSING
    ) {
      throw new ProcessingJobError("REPROCESS_CONFLICT", "A nota já possui processamento ativo.");
    }

    const reset = await tx.note.updateMany({
      where: { id: noteId, status: note.status, version: note.version },
      data: {
        auditResult: null,
        classification: null,
        contextRound: (latestQuestion?.round ?? 0) + 1,
        contextSubmittedAt: null,
        contextSummary: null,
        documentNumber: null,
        extractedData: Prisma.DbNull,
        extractionMarkdown: null,
        failureCode: null,
        failureMessage: null,
        ...revokedPublicCapabilityFields(),
        issuedAt: null,
        processedAt: null,
        processingStage: ProcessingStage.RECEIVED,
        readConfidence: null,
        status: NoteStatus.RECEIVED,
        supplierName: null,
        supplierTaxId: null,
        totalAmount: null,
        version: { increment: 1 },
      },
    });
    if (reset.count !== 1) {
      throw new ProcessingJobError("REPROCESS_CONFLICT", "A nota mudou durante o reprocessamento.");
    }
    await tx.finding.updateMany({
      where: { noteId, status: FindingStatus.OPEN },
      data: { needsValidation: false, status: FindingStatus.RESOLVED },
    });
    await tx.processingJob.updateMany({
      where: { noteId, status: { in: [ProcessingJobStatus.PENDING, ProcessingJobStatus.FAILED] } },
      data: { completedAt: new Date(), status: ProcessingJobStatus.CANCELLED },
    });
    await tx.noteItem.deleteMany({ where: { noteId } });
    const job = await tx.processingJob.create({
      data: {
        idempotencyKey: `reprocess:${noteId}:${note.version + 1}`,
        noteId,
        type: ProcessingJobType.FULL_AUDIT,
      },
      select: { id: true, status: true },
    });
    await tx.noteEvent.create({
      data: {
        noteId,
        type: "REPROCESS_SCHEDULED",
        fromStatus: note.status,
        toStatus: NoteStatus.RECEIVED,
        data: { jobId: job.id },
      },
    });
    return job;
  });
}

import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  FindingStatus,
  NoteStatus,
  ProcessingJobStatus,
  ProcessingJobType,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { processNoteAudit } from "./process-note-audit";
import { processNoteExtraction } from "./process-note-extraction";

export class ProcessingJobError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProcessingJobError";
  }
}

export async function createInitialProcessingJob(
  transaction: Prisma.TransactionClient,
  noteId: string,
) {
  return transaction.processingJob.create({
    data: {
      availableAt: new Date(Date.now() + 10 * 60 * 1_000),
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
      select: { extractedData: true, failureCode: true },
    });
    const retryingAudit =
      Boolean(noteState.extractedData) &&
      noteState.failureCode?.startsWith("AUDIT_");
    if (retryingAudit) {
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
    await prisma.processingJob.updateMany({
      where: { id: job.id, lockedBy: workerId, status: ProcessingJobStatus.RUNNING },
      data: {
        availableAt: new Date(Date.now() + Math.min(2 ** job.attempt * 1_000, 60_000)),
        lastError: "O pipeline não pôde ser concluído.",
        lastErrorCode: error instanceof ProcessingJobError ? error.code : "PIPELINE_FAILED",
        lockedAt: null,
        lockedBy: null,
        status: ProcessingJobStatus.FAILED,
      },
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
        processingJobs: {
          where: { status: { in: [ProcessingJobStatus.PENDING, ProcessingJobStatus.RUNNING] } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!note) throw new ProcessingJobError("NOTE_NOT_FOUND", "Nota não encontrada.");
    if (note.processingJobs.length > 0 || note.status === NoteStatus.PROCESSING) {
      throw new ProcessingJobError("REPROCESS_CONFLICT", "A nota já possui processamento ativo.");
    }

    await tx.finding.updateMany({
      where: { noteId, status: FindingStatus.OPEN },
      data: { needsValidation: false, status: FindingStatus.RESOLVED },
    });
    await tx.processingJob.updateMany({
      where: { noteId, status: { in: [ProcessingJobStatus.PENDING, ProcessingJobStatus.FAILED] } },
      data: { completedAt: new Date(), status: ProcessingJobStatus.CANCELLED },
    });
    await tx.note.update({
      where: { id: noteId },
      data: {
        classification: null,
        documentNumber: null,
        extractedData: Prisma.DbNull,
        extractionMarkdown: null,
        failureCode: null,
        failureMessage: null,
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

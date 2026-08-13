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

const GENERIC_PIPELINE_FAILURE_MESSAGE = "O pipeline não pôde ser concluído.";
const MAX_PERSISTED_ERROR_MESSAGE_LENGTH = 300;

export function auditRecoveryIdempotencyKey(noteId: string, version: number) {
  return `audit-recovery:${noteId}:${version}`;
}

export function processingFailureLifecycle(input: {
  attempt: number;
  failureCode?: string;
  maxAttempts: number;
  type: ProcessingJobType;
}) {
  // The clients already execute their bounded provider recovery. Retrying the
  // outer ProcessingJob would repeat paid calls and make one failure look like
  // an endless analysis to the public flow.
  const attemptsExhausted =
    input.attempt >= input.maxAttempts ||
    Boolean(input.failureCode?.startsWith("AUDIT_")) ||
    input.failureCode === "EXTRACTION_CREDIT_EXHAUSTED" ||
    input.failureCode === "EXTRACTION_INVALID_RESPONSE" ||
    input.failureCode === "EXTRACTION_REQUEST_REJECTED";
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

export function pipelineFailureDetails(error: unknown) {
  const rawCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "PIPELINE_FAILED";
  const code = /^[A-Z0-9][A-Z0-9_.:-]{0,79}$/.test(rawCode)
    ? rawCode
    : "PIPELINE_FAILED";
  const rawMessage =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : error instanceof Error
        ? error.message
        : "";
  const normalizedMessage = rawMessage.replace(/\s+/g, " ").trim();
  if (!normalizedMessage) {
    return { code, message: GENERIC_PIPELINE_FAILURE_MESSAGE };
  }

  const message = normalizedMessage
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /\b(api[-_ ]?key|authorization|token|secret|signed[-_ ]?url)\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1?[REDACTED]")
    .slice(0, MAX_PERSISTED_ERROR_MESSAGE_LENGTH);

  return {
    code,
    message: message || GENERIC_PIPELINE_FAILURE_MESSAGE,
  };
}

export function shouldRunAuditWithoutExtraction(input: {
  extractedData: unknown;
  failureCode: string | null;
  processingStage: ProcessingStage;
  type: ProcessingJobType;
}) {
  const hasExtractedData =
    input.extractedData !== null && input.extractedData !== undefined;

  return (
    input.type === ProcessingJobType.CONTEXT_REANALYSIS ||
    (hasExtractedData &&
      (input.processingStage === ProcessingStage.ANALYZING ||
        input.processingStage === ProcessingStage.FINALIZING ||
        input.processingStage === ProcessingStage.FAILED ||
        input.failureCode?.startsWith("AUDIT_")))
  );
}

export function canScheduleAuditRecovery(input: {
  processingStage: ProcessingStage;
  status: NoteStatus;
}) {
  const interruptedAudit =
    (input.status === NoteStatus.PROCESSING ||
      input.status === NoteStatus.FAILED) &&
    (input.processingStage === ProcessingStage.ANALYZING ||
      input.processingStage === ProcessingStage.FINALIZING ||
      input.processingStage === ProcessingStage.FAILED);
  const falseReadFailureCandidate =
    input.status === NoteStatus.READ_FAILED &&
    input.processingStage === ProcessingStage.COMPLETED;

  return interruptedAudit || falseReadFailureCandidate;
}

type ClaimedPipelineJob = {
  contextSubmissionId: string | null;
  id: string;
  noteId: string;
  type: ProcessingJobType;
};

type PipelineNoteState = {
  extractedData: unknown;
  failureCode: string | null;
  processingStage: ProcessingStage;
};

export async function runClaimedProcessingJobPipeline(
  job: ClaimedPipelineJob,
  dependencies: {
    findNoteState: (noteId: string) => Promise<PipelineNoteState>;
    markAuditStarted: (noteId: string) => Promise<unknown>;
    processAudit: typeof processNoteAudit;
    processExtraction: typeof processNoteExtraction;
  },
) {
  const noteState = await dependencies.findNoteState(job.noteId);
  if (
    shouldRunAuditWithoutExtraction({
      ...noteState,
      type: job.type,
    })
  ) {
    await dependencies.markAuditStarted(job.noteId);
  } else {
    await dependencies.processExtraction(job.noteId, {
      processingJobId: job.id,
    });
  }

  return dependencies.processAudit(job.noteId, {
    contextSubmissionId: job.contextSubmissionId ?? undefined,
    processingJobId: job.id,
  });
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
      // A public upload gets one automatic retry. If both attempts fail, the
      // caller receives a terminal error and can submit the file again; it
      // must never remain in an endless "em análise" state.
      maxAttempts: 2,
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
    const note = await runClaimedProcessingJobPipeline(job, {
      findNoteState: (noteId) =>
        prisma.note.findUniqueOrThrow({
          where: { id: noteId },
          select: {
            extractedData: true,
            failureCode: true,
            processingStage: true,
          },
        }),
      markAuditStarted: (noteId) =>
        prisma.note.update({
          where: { id: noteId },
          data: {
            failureCode: null,
            failureMessage: null,
            processingStage: ProcessingStage.ANALYZING,
            status: NoteStatus.PROCESSING,
            version: { increment: 1 },
          },
        }),
      processAudit: dependencies.processAudit ?? processNoteAudit,
      processExtraction: dependencies.processExtraction ?? processNoteExtraction,
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
    const failure = pipelineFailureDetails(error);
    const lifecycle = processingFailureLifecycle({
      ...job,
      failureCode: failure.code,
    });
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
          lastError: failure.message,
          lastErrorCode: failure.code,
          lockedAt: null,
          lockedBy: null,
          status: lifecycle.attemptsExhausted
            ? ProcessingJobStatus.CANCELLED
            : ProcessingJobStatus.FAILED,
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
      const noteAlreadyTerminal =
        currentNote?.processingStage === ProcessingStage.COMPLETED &&
        currentNote.status !== NoteStatus.RECEIVED &&
        currentNote.status !== NoteStatus.PROCESSING &&
        currentNote.status !== NoteStatus.FAILED;
      const noteAlreadyFailed =
        currentNote?.processingStage === ProcessingStage.FAILED &&
        currentNote.status === NoteStatus.FAILED;
      if (
        !currentNote ||
        noteAlreadyTerminal ||
        (lifecycle.attemptsExhausted && noteAlreadyFailed)
      ) {
        return;
      }

      const retryStage =
        job.type === ProcessingJobType.CONTEXT_REANALYSIS ||
        Boolean(currentNote.extractedData)
          ? ProcessingStage.ANALYZING
          : ProcessingStage.EXTRACTING;
      const noteUpdated = await tx.note.updateMany({
        where: lifecycle.attemptsExhausted
          ? {
              id: job.noteId,
              status: {
                in: [NoteStatus.RECEIVED, NoteStatus.PROCESSING, NoteStatus.FAILED],
              },
            }
          : {
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
              failureCode: failure.code,
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
            failureCode: failure.code,
            failureMessage: failure.message,
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

export async function scheduleNoteAuditRecoveryInTransaction(
  transaction: Prisma.TransactionClient,
  noteId: string,
  now = new Date(),
) {
  const note = await transaction.note.findUnique({
    where: { id: noteId },
    select: {
      extractedData: true,
      id: true,
      processingStage: true,
      status: true,
      version: true,
    },
  });
  if (!note) {
    throw new ProcessingJobError("NOTE_NOT_FOUND", "Nota não encontrada.");
  }
  if (note.extractedData === null || note.extractedData === undefined) {
    throw new ProcessingJobError(
      "AUDIT_RECOVERY_REQUIRES_EXTRACTION",
      "A nota não possui extração persistida para recuperar somente a auditoria.",
    );
  }

  if (!canScheduleAuditRecovery(note)) {
    throw new ProcessingJobError(
      "AUDIT_RECOVERY_NOT_ALLOWED",
      "A nota não está em um estado recuperável de auditoria.",
    );
  }

  const currentVersionKey = auditRecoveryIdempotencyKey(note.id, note.version);
  const previouslyScheduled = await transaction.processingJob.findUnique({
    where: { idempotencyKey: currentVersionKey },
    select: { id: true, status: true },
  });
  if (previouslyScheduled) return previouslyScheduled;

  const unfinishedJobs = await transaction.processingJob.findMany({
    where: {
      noteId,
      status: {
        in: [
          ProcessingJobStatus.PENDING,
          ProcessingJobStatus.RUNNING,
          ProcessingJobStatus.FAILED,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      attempt: true,
      id: true,
      maxAttempts: true,
      status: true,
      type: true,
    },
  });
  const blockingJob = unfinishedJobs.find(
    (job) =>
      job.status === ProcessingJobStatus.PENDING ||
      job.status === ProcessingJobStatus.RUNNING ||
      (job.status === ProcessingJobStatus.FAILED &&
        job.attempt < job.maxAttempts),
  );
  if (blockingJob) {
    throw new ProcessingJobError(
      "AUDIT_RECOVERY_CONFLICT",
      "A nota ainda possui um job com tentativas disponíveis.",
    );
  }

  const previousJob = unfinishedJobs[0];
  if (previousJob?.type === ProcessingJobType.CONTEXT_REANALYSIS) {
    throw new ProcessingJobError(
      "AUDIT_RECOVERY_CONTEXT_CONFLICT",
      "A reanálise de contexto deve ser recuperada com a submissão correspondente.",
    );
  }

  const recoveryVersion = note.version + 1;
  const idempotencyKey = auditRecoveryIdempotencyKey(note.id, recoveryVersion);
  const concurrentlyScheduled = await transaction.processingJob.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (concurrentlyScheduled) return concurrentlyScheduled;

  const transitioned = await transaction.note.updateMany({
    where: {
      id: note.id,
      processingStage: note.processingStage,
      status: note.status,
      version: note.version,
    },
    data: {
      auditResult: null,
      classification: null,
      failureCode: null,
      failureMessage: null,
      processedAt: null,
      processingStage: ProcessingStage.ANALYZING,
      status: NoteStatus.PROCESSING,
      version: { increment: 1 },
    },
  });
  if (transitioned.count !== 1) {
    const scheduledAfterConflict = await transaction.processingJob.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    });
    if (scheduledAfterConflict) return scheduledAfterConflict;
    throw new ProcessingJobError(
      "AUDIT_RECOVERY_CONFLICT",
      "A nota mudou durante o reagendamento da auditoria.",
    );
  }

  const exhaustedJobIds = unfinishedJobs
    .filter(
      (job) =>
        job.status === ProcessingJobStatus.FAILED &&
        job.attempt >= job.maxAttempts,
    )
    .map((job) => job.id);
  if (exhaustedJobIds.length > 0) {
    await transaction.processingJob.updateMany({
      where: {
        id: { in: exhaustedJobIds },
        status: ProcessingJobStatus.FAILED,
      },
      data: {
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        status: ProcessingJobStatus.CANCELLED,
      },
    });
  }

  const job = await transaction.processingJob.create({
    data: {
      availableAt: now,
      idempotencyKey,
      maxAttempts: 2,
      noteId: note.id,
      type: ProcessingJobType.FULL_AUDIT,
    },
    select: { id: true, status: true },
  });
  await transaction.noteEvent.create({
    data: {
      noteId: note.id,
      type: "AUDIT_RECOVERY_SCHEDULED",
      fromStatus: note.status,
      toStatus: NoteStatus.PROCESSING,
      data: {
        auditOnly: true,
        jobId: job.id,
        previousAttempt: previousJob?.attempt ?? null,
        previousJobId: previousJob?.id ?? null,
        previousMaxAttempts: previousJob?.maxAttempts ?? null,
        recoveryVersion,
      },
    },
  });

  return job;
}

export async function scheduleNoteAuditRecovery(noteId: string) {
  return prisma.$transaction((transaction) =>
    scheduleNoteAuditRecoveryInTransaction(transaction, noteId),
  );
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
        maxAttempts: 2,
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

import "server-only";

import { randomUUID } from "node:crypto";

import {
  AiRunStatus,
  ContextSubmissionStatus,
  NoteStatus,
  ProcessingJobStatus,
  ProcessingJobType,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import {
  processingFailureLifecycle,
  processProcessingJob,
} from "@/server/notes/processing-jobs";
import { terminalPublicCapabilityFields } from "@/server/notes/public-capability";

export const PROCESSING_WORKER_DEFAULT_BATCH_SIZE = 1;
export const PROCESSING_WORKER_MAX_BATCH_SIZE = 3;
export const PROCESSING_WORKER_LEASE_TIMEOUT_MS = 6 * 60 * 1_000;
export const PROCESSING_WORKER_RUNTIME_BUDGET_MS = 250 * 1_000;

export type ProcessingWorkerRunOptions = {
  batchSize?: number;
  leaseTimeoutMs?: number;
  maxRuntimeMs?: number;
  workerId?: string;
};

type ProcessingWorkerDependencies = {
  findNextJobId?: () => Promise<string | null>;
  processJob?: (
    jobId: string,
    options: { workerId?: string },
  ) => Promise<unknown>;
  recoverExpiredLeases?: (leaseTimeoutMs: number) => Promise<LeaseRecoveryResult>;
};

export type LeaseRecoveryResult = {
  completed: number;
  exhausted: number;
  recovered: number;
  scanned: number;
};

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum);
}

export function normalizeProcessingWorkerOptions(
  options: ProcessingWorkerRunOptions = {},
) {
  return {
    batchSize: boundedInteger(
      options.batchSize,
      PROCESSING_WORKER_DEFAULT_BATCH_SIZE,
      PROCESSING_WORKER_MAX_BATCH_SIZE,
    ),
    leaseTimeoutMs: boundedInteger(
      options.leaseTimeoutMs,
      PROCESSING_WORKER_LEASE_TIMEOUT_MS,
      30 * 60 * 1_000,
    ),
    maxRuntimeMs: boundedInteger(
      options.maxRuntimeMs,
      PROCESSING_WORKER_RUNTIME_BUDGET_MS,
      PROCESSING_WORKER_RUNTIME_BUDGET_MS,
    ),
    workerId: options.workerId ?? `durable:${randomUUID()}`,
  };
}

async function findNextDueProcessingJobId() {
  const candidate = await prisma.processingJob.findFirst({
    where: {
      attempt: { lt: prisma.processingJob.fields.maxAttempts },
      availableAt: { lte: new Date() },
      status: {
        in: [ProcessingJobStatus.PENDING, ProcessingJobStatus.FAILED],
      },
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  return candidate?.id ?? null;
}

function retryFailureForStage(
  stage: ProcessingStage,
  hasExtractedData: boolean,
) {
  const auditCanResume =
    hasExtractedData &&
    (stage === ProcessingStage.ANALYZING ||
      stage === ProcessingStage.FINALIZING);

  return auditCanResume
    ? {
        code: "AUDIT_WORKER_INTERRUPTED",
        message: "A auditoria foi interrompida e será retomada automaticamente.",
      }
    : {
        code: "EXTRACTION_WORKER_INTERRUPTED",
        message: "A extração foi interrompida e será retomada automaticamente.",
      };
}

export async function recoverExpiredProcessingJobLeases(
  leaseTimeoutMs = PROCESSING_WORKER_LEASE_TIMEOUT_MS,
): Promise<LeaseRecoveryResult> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - leaseTimeoutMs);
  const staleJobs = await prisma.processingJob.findMany({
    where: {
      lockedAt: { lt: staleBefore },
      status: ProcessingJobStatus.RUNNING,
    },
    orderBy: { lockedAt: "asc" },
    select: { id: true },
    take: 25,
  });

  let recovered = 0;
  let exhausted = 0;
  let completed = 0;

  for (const staleJob of staleJobs) {
    const outcome = await prisma.$transaction(async (transaction) => {
      const job = await transaction.processingJob.findUnique({
        where: { id: staleJob.id },
        select: {
          attempt: true,
          contextSubmissionId: true,
          id: true,
          lockedAt: true,
          maxAttempts: true,
          noteId: true,
          status: true,
          type: true,
        },
      });

      if (
        !job ||
        job.status !== ProcessingJobStatus.RUNNING ||
        !job.lockedAt ||
        job.lockedAt >= staleBefore
      ) {
        return "skipped" as const;
      }

      const lifecycle = processingFailureLifecycle(job);
      const note = await transaction.note.findUnique({
        where: { id: job.noteId },
        select: {
          extractedData: true,
          processingStage: true,
          status: true,
        },
      });
      const noteAlreadyCompleted =
        note?.processingStage === ProcessingStage.COMPLETED &&
        note.status !== NoteStatus.RECEIVED &&
        note.status !== NoteStatus.PROCESSING &&
        note.status !== NoteStatus.FAILED;

      if (noteAlreadyCompleted) {
        const finalized = await transaction.processingJob.updateMany({
          where: {
            id: job.id,
            lockedAt: { lte: staleBefore },
            status: ProcessingJobStatus.RUNNING,
          },
          data: {
            completedAt: now,
            lastError: null,
            lastErrorCode: null,
            lockedAt: null,
            lockedBy: null,
            status: ProcessingJobStatus.SUCCEEDED,
          },
        });
        return finalized.count === 1
          ? ("completed" as const)
          : ("skipped" as const);
      }

      const claimedRecovery = await transaction.processingJob.updateMany({
        where: {
          id: job.id,
          lockedAt: { lte: staleBefore },
          status: ProcessingJobStatus.RUNNING,
        },
        data: {
          availableAt: now,
          completedAt: lifecycle.attemptsExhausted ? now : null,
          lastError: lifecycle.attemptsExhausted
            ? "O processamento excedeu o número máximo de tentativas."
            : "O worker anterior perdeu a concessão; o job será retomado.",
          lastErrorCode: lifecycle.attemptsExhausted
            ? "PROCESSING_ATTEMPTS_EXHAUSTED"
            : "WORKER_LEASE_EXPIRED",
          lockedAt: null,
          lockedBy: null,
          status: lifecycle.attemptsExhausted
            ? ProcessingJobStatus.CANCELLED
            : ProcessingJobStatus.FAILED,
        },
      });
      if (claimedRecovery.count !== 1) return "skipped" as const;
      await transaction.aiRun.updateMany({
        where: {
          processingJobId: job.id,
          status: AiRunStatus.RUNNING,
        },
        data: {
          completedAt: now,
          errorCode: "WORKER_LEASE_EXPIRED",
          errorMessage: "A execução foi interrompida antes da conclusão.",
          status: AiRunStatus.FAILED,
        },
      });

      if (note) {
        const failure = lifecycle.attemptsExhausted
          ? {
              code: "PROCESSING_ATTEMPTS_EXHAUSTED",
              message: "O anexo não pôde ser processado após as tentativas automáticas.",
            }
          : retryFailureForStage(
              note.processingStage,
              Boolean(note.extractedData),
            );

        const retryStage = note.extractedData
          ? ProcessingStage.ANALYZING
          : ProcessingStage.EXTRACTING;
        const noteUpdated = await transaction.note.updateMany({
          where: {
            id: job.noteId,
            processingStage: { not: ProcessingStage.COMPLETED },
          },
          data: lifecycle.attemptsExhausted
            ? {
                failureCode: failure.code,
                failureMessage: failure.message,
                ...terminalPublicCapabilityFields(),
                processingStage: ProcessingStage.FAILED,
                status: NoteStatus.FAILED,
                version: { increment: 1 },
              }
            : {
                failureCode: failure.code,
                failureMessage: failure.message,
                processingStage: retryStage,
                status: NoteStatus.PROCESSING,
                version: { increment: 1 },
              },
        });
        if (noteUpdated.count === 1) {
          if (
            lifecycle.contextSubmissionStatus &&
            job.contextSubmissionId
          ) {
            await transaction.noteContextSubmission.updateMany({
              where: {
                id: job.contextSubmissionId,
                status: {
                  in: [
                    ContextSubmissionStatus.SUBMITTED,
                    ContextSubmissionStatus.REANALYSIS_QUEUED,
                  ],
                },
              },
              data: {
                reanalysisCompletedAt: now,
                status: lifecycle.contextSubmissionStatus,
              },
            });
          }
          await transaction.noteEvent.create({
            data: {
              noteId: job.noteId,
              type: lifecycle.attemptsExhausted
                ? "PROCESSING_ATTEMPTS_EXHAUSTED"
                : "WORKER_LEASE_RECOVERED",
              fromStatus: note.status,
              toStatus: lifecycle.noteStatus,
              data: {
                jobId: job.id,
                nextAttempt: lifecycle.attemptsExhausted
                  ? null
                  : job.attempt + 1,
              },
            },
          });
        }
      }

      return lifecycle.attemptsExhausted
        ? ("exhausted" as const)
        : ("recovered" as const);
    });

    if (outcome === "recovered") recovered += 1;
    if (outcome === "exhausted") exhausted += 1;
    if (outcome === "completed") completed += 1;
  }

  return { completed, exhausted, recovered, scanned: staleJobs.length };
}

export async function getProcessingQueueRecoveryPreview() {
  const staleBefore = new Date(
    Date.now() - PROCESSING_WORKER_LEASE_TIMEOUT_MS,
  );
  const [orphaned, stale, due] = await Promise.all([
    prisma.note.findMany({
      where: {
        processingJobs: { none: {} },
        status: NoteStatus.RECEIVED,
      },
      orderBy: { receivedAt: "asc" },
      select: {
        id: true,
        originalFileName: true,
        receivedAt: true,
        work: { select: { code: true, name: true } },
      },
      take: 25,
    }),
    prisma.processingJob.count({
      where: {
        lockedAt: { lt: staleBefore },
        status: ProcessingJobStatus.RUNNING,
      },
    }),
    prisma.processingJob.count({
      where: {
        availableAt: { lte: new Date() },
        status: {
          in: [ProcessingJobStatus.PENDING, ProcessingJobStatus.FAILED],
        },
      },
    }),
  ]);

  return {
    due,
    orphaned,
    orphanedCount: orphaned.length,
    stale,
  };
}

export async function scheduleOrphanedNotesForRecovery(noteIds: string[]) {
  const uniqueNoteIds = [...new Set(noteIds)].slice(0, 25);
  if (uniqueNoteIds.length === 0) {
    return { scheduled: [] as string[], skipped: [] as string[] };
  }

  return prisma.$transaction(async (transaction) => {
    const notes = await transaction.note.findMany({
      where: {
        id: { in: uniqueNoteIds },
        processingJobs: { none: {} },
        status: NoteStatus.RECEIVED,
      },
      select: { id: true },
    });
    const eligibleIds = new Set(notes.map((note) => note.id));

    for (const note of notes) {
      const job = await transaction.processingJob.create({
        data: {
          availableAt: new Date(),
          idempotencyKey: `recovery:${note.id}`,
          noteId: note.id,
          type: ProcessingJobType.FULL_AUDIT,
        },
        select: { id: true },
      });
      await transaction.noteEvent.create({
        data: {
          noteId: note.id,
          type: "PROCESSING_RECOVERY_SCHEDULED",
          fromStatus: NoteStatus.RECEIVED,
          toStatus: NoteStatus.RECEIVED,
          data: { jobId: job.id },
        },
      });
    }

    return {
      scheduled: notes.map((note) => note.id),
      skipped: uniqueNoteIds.filter((noteId) => !eligibleIds.has(noteId)),
    };
  });
}

export async function drainProcessingQueue(
  options: ProcessingWorkerRunOptions = {},
  dependencies: ProcessingWorkerDependencies = {},
) {
  const normalized = normalizeProcessingWorkerOptions(options);
  const startedAt = Date.now();
  const recovery = await (
    dependencies.recoverExpiredLeases ?? recoverExpiredProcessingJobLeases
  )(normalized.leaseTimeoutMs);
  const executions: Array<{
    errorCode?: string;
    jobId: string;
    status: "failed" | "succeeded";
  }> = [];

  while (
    executions.length < normalized.batchSize &&
    Date.now() - startedAt < normalized.maxRuntimeMs
  ) {
    const jobId = await (
      dependencies.findNextJobId ?? findNextDueProcessingJobId
    )();
    if (!jobId) break;

    try {
      await (dependencies.processJob ?? processProcessingJob)(jobId, {
        workerId: normalized.workerId,
      });
      executions.push({ jobId, status: "succeeded" });
    } catch (error) {
      executions.push({
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "PIPELINE_FAILED",
        jobId,
        status: "failed",
      });
    }
  }

  return {
    durationMs: Date.now() - startedAt,
    executions,
    processed: executions.length,
    recovery,
    workerId: normalized.workerId,
  };
}

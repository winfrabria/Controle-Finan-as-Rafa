import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/generated/prisma/client";
import {
  NoteStatus,
  ProcessingJobStatus,
  ProcessingJobType,
  ProcessingStage,
} from "@/generated/prisma/enums";
import {
  auditRecoveryIdempotencyKey,
  canScheduleAuditRecovery,
  pipelineFailureDetails,
  processingFailureLifecycle,
  runClaimedProcessingJobPipeline,
  scheduleNoteAuditRecoveryInTransaction,
} from "./processing-jobs";

test("recuperação audit-only aceita falso READ_FAILED com extração persistida", () => {
  assert.equal(
    canScheduleAuditRecovery({
      processingStage: ProcessingStage.COMPLETED,
      status: NoteStatus.READ_FAILED,
    }),
    true,
  );
  assert.equal(
    canScheduleAuditRecovery({
      processingStage: ProcessingStage.COMPLETED,
      status: NoteStatus.OK,
    }),
    false,
  );
});

test("job completo sem extração executa leitura antes da auditoria", async () => {
  const calls: string[] = [];

  await runClaimedProcessingJobPipeline(
    {
      contextSubmissionId: null,
      id: "job-full-audit",
      noteId: "note-full-audit",
      type: ProcessingJobType.FULL_AUDIT,
    },
    {
      findNoteState: async () => ({
        extractedData: null,
        failureCode: null,
        processingStage: ProcessingStage.RECEIVED,
      }),
      markAuditStarted: async () => {
        calls.push("mark-audit-started");
      },
      processExtraction: async (_noteId, options) => {
        assert.equal(options?.processingJobId, "job-full-audit");
        calls.push("extraction");
        return { id: "note-full-audit" } as never;
      },
      processAudit: async (_noteId, options) => {
        assert.equal(options?.processingJobId, "job-full-audit");
        calls.push("audit");
        return { id: "note-full-audit" } as never;
      },
    },
  );

  assert.deepEqual(calls, ["extraction", "audit"]);
});

test("retry de auditoria usa extractedData sem repetir extração", async () => {
  let auditCalls = 0;
  let extractionCalls = 0;
  let markAuditStartedCalls = 0;

  await runClaimedProcessingJobPipeline(
    {
      contextSubmissionId: null,
      id: "job-audit-retry",
      noteId: "note-audit-retry",
      type: ProcessingJobType.FULL_AUDIT,
    },
    {
      findNoteState: async () => ({
        extractedData: { documentNumber: "123" },
        failureCode: "PROCESSING_ATTEMPTS_EXHAUSTED",
        processingStage: ProcessingStage.ANALYZING,
      }),
      markAuditStarted: async () => {
        markAuditStartedCalls += 1;
      },
      processAudit: async (_noteId, options) => {
        auditCalls += 1;
        assert.equal(options?.processingJobId, "job-audit-retry");
        return { id: "note-audit-retry" } as never;
      },
      processExtraction: async () => {
        extractionCalls += 1;
        throw new Error("A extração não deveria ser executada.");
      },
    },
  );

  assert.equal(markAuditStartedCalls, 1);
  assert.equal(auditCalls, 1);
  assert.equal(extractionCalls, 0);
});

test("reagendamento audit-only é idempotente por noteId e version", async () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const extractedData = { documentNumber: "NF-42", totalAmount: 120 };
  const note = {
    extractedData,
    id: "note-42",
    processingStage: ProcessingStage.ANALYZING,
    status: NoteStatus.PROCESSING,
    version: 7,
  };
  type MemoryJob = {
    attempt: number;
    completedAt: Date | null;
    id: string;
    idempotencyKey: string;
    lockedAt: Date | null;
    lockedBy: string | null;
    maxAttempts: number;
    noteId: string;
    status: ProcessingJobStatus;
    type: ProcessingJobType;
  };
  const jobs: MemoryJob[] = [
    {
      attempt: 2,
      completedAt: null as Date | null,
      id: "job-exhausted",
      idempotencyKey: "upload:note-42",
      lockedAt: null as Date | null,
      lockedBy: null as string | null,
      maxAttempts: 2,
      noteId: note.id,
      status: ProcessingJobStatus.FAILED,
      type: ProcessingJobType.FULL_AUDIT,
    },
  ];
  const events: unknown[] = [];
  let createdJobs = 0;

  const transaction = {
    note: {
      findUnique: async () => ({ ...note }),
      updateMany: async (query: unknown) => {
        const input = query as {
          where: {
            id: string;
            processingStage: ProcessingStage;
            status: NoteStatus;
            version: number;
          };
        };
        if (
          input.where.id !== note.id ||
          input.where.processingStage !== note.processingStage ||
          input.where.status !== note.status ||
          input.where.version !== note.version
        ) {
          return { count: 0 };
        }
        note.processingStage = ProcessingStage.ANALYZING;
        note.status = NoteStatus.PROCESSING;
        note.version += 1;
        return { count: 1 };
      },
    },
    noteEvent: {
      create: async (query: unknown) => {
        events.push(query);
        return query;
      },
    },
    processingJob: {
      create: async (query: unknown) => {
        const input = query as {
          data: {
            idempotencyKey: string;
            maxAttempts: number;
            noteId: string;
            type: ProcessingJobType;
          };
        };
        createdJobs += 1;
        const job = {
          attempt: 0,
          completedAt: null,
          id: `job-recovery-${createdJobs}`,
          idempotencyKey: input.data.idempotencyKey,
          lockedAt: null,
          lockedBy: null,
          maxAttempts: input.data.maxAttempts,
          noteId: input.data.noteId,
          status: ProcessingJobStatus.PENDING,
          type: input.data.type,
        };
        jobs.push(job);
        return { id: job.id, status: job.status };
      },
      findMany: async () => {
        const unfinishedStatuses: ProcessingJobStatus[] = [
          ProcessingJobStatus.PENDING,
          ProcessingJobStatus.RUNNING,
          ProcessingJobStatus.FAILED,
        ];
        return jobs.filter((job) => unfinishedStatuses.includes(job.status));
      },
      findUnique: async (query: unknown) => {
        const input = query as { where: { idempotencyKey: string } };
        const job = jobs.find(
          (candidate) =>
            candidate.idempotencyKey === input.where.idempotencyKey,
        );
        return job ? { id: job.id, status: job.status } : null;
      },
      updateMany: async (query: unknown) => {
        const input = query as { where: { id: { in: string[] } } };
        let count = 0;
        for (const job of jobs) {
          if (input.where.id.in.includes(job.id)) {
            job.completedAt = now;
            job.lockedAt = null;
            job.lockedBy = null;
            job.status = ProcessingJobStatus.CANCELLED;
            count += 1;
          }
        }
        return { count };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const first = await scheduleNoteAuditRecoveryInTransaction(
    transaction,
    note.id,
    now,
  );
  const second = await scheduleNoteAuditRecoveryInTransaction(
    transaction,
    note.id,
    now,
  );

  assert.deepEqual(second, first);
  assert.equal(createdJobs, 1);
  assert.equal(events.length, 1);
  assert.equal(note.version, 8);
  assert.equal(note.extractedData, extractedData);
  assert.equal(jobs[0]?.status, ProcessingJobStatus.CANCELLED);
  assert.equal(jobs[0]?.completedAt, now);
  assert.equal(
    jobs[1]?.idempotencyKey,
    auditRecoveryIdempotencyKey(note.id, note.version),
  );
});

test("falha esgotada é terminal e preserva mensagem segura para observabilidade", () => {
  const error = Object.assign(
    new Error(
      "Auditoria indisponível; Authorization: Bearer secret-value https://provider.test/run?token=signed-value",
    ),
    { code: "AUDIT_PROVIDER_ERROR" },
  );
  const failure = pipelineFailureDetails(error);
  const lifecycle = processingFailureLifecycle({
    attempt: 2,
    maxAttempts: 2,
    type: ProcessingJobType.FULL_AUDIT,
  });

  assert.equal(failure.code, "AUDIT_PROVIDER_ERROR");
  assert.match(failure.message, /Auditoria indisponível/);
  assert.equal(failure.message.includes("secret-value"), false);
  assert.equal(failure.message.includes("signed-value"), false);
  assert.equal(lifecycle.attemptsExhausted, true);
  assert.equal(lifecycle.noteStatus, NoteStatus.FAILED);
  assert.equal(lifecycle.noteStage, ProcessingStage.FAILED);
});

test("rota interna esgotada não é repetida pelo job externo", () => {
  const auditFailure = processingFailureLifecycle({
    attempt: 1,
    failureCode: "AUDIT_TIMEOUT",
    maxAttempts: 2,
    type: ProcessingJobType.FULL_AUDIT,
  });
  const extractionFailure = processingFailureLifecycle({
    attempt: 1,
    failureCode: "EXTRACTION_PROVIDER_ERROR",
    maxAttempts: 2,
    type: ProcessingJobType.FULL_AUDIT,
  });
  const invalidExtraction = processingFailureLifecycle({
    attempt: 1,
    failureCode: "EXTRACTION_INVALID_RESPONSE",
    maxAttempts: 2,
    type: ProcessingJobType.FULL_AUDIT,
  });
  const rejectedExtraction = processingFailureLifecycle({
    attempt: 1,
    failureCode: "EXTRACTION_REQUEST_REJECTED",
    maxAttempts: 2,
    type: ProcessingJobType.FULL_AUDIT,
  });
  const creditExhausted = processingFailureLifecycle({
    attempt: 1,
    failureCode: "EXTRACTION_CREDIT_EXHAUSTED",
    maxAttempts: 2,
    type: ProcessingJobType.FULL_AUDIT,
  });

  assert.equal(auditFailure.attemptsExhausted, true);
  assert.equal(auditFailure.noteStatus, NoteStatus.FAILED);
  assert.equal(extractionFailure.attemptsExhausted, false);
  assert.equal(extractionFailure.noteStatus, NoteStatus.PROCESSING);
  assert.equal(invalidExtraction.attemptsExhausted, true);
  assert.equal(invalidExtraction.noteStatus, NoteStatus.FAILED);
  assert.equal(rejectedExtraction.attemptsExhausted, true);
  assert.equal(rejectedExtraction.noteStatus, NoteStatus.FAILED);
  assert.equal(creditExhausted.attemptsExhausted, true);
  assert.equal(creditExhausted.noteStatus, NoteStatus.FAILED);
});

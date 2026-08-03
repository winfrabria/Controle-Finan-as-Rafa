import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextSubmissionStatus,
  NoteStatus,
  ProcessingJobType,
  ProcessingStage,
} from "@/generated/prisma/enums";
import {
  ACTIVE_CONTEXT_SUBMISSION_STATUSES,
  processingFailureLifecycle,
} from "./processing-jobs";
import {
  drainProcessingQueue,
  normalizeProcessingWorkerOptions,
} from "./processing-worker";

test("falha antes do limite mantém a nota processável e a capability ativa", () => {
  const lifecycle = processingFailureLifecycle({
    attempt: 1,
    maxAttempts: 3,
    type: ProcessingJobType.FULL_AUDIT,
  });

  assert.equal(lifecycle.attemptsExhausted, false);
  assert.equal(lifecycle.noteStatus, NoteStatus.PROCESSING);
  assert.equal(lifecycle.noteStage, ProcessingStage.EXTRACTING);
  assert.equal(lifecycle.contextSubmissionStatus, null);
});

test("reanálise só termina e libera a submissão quando esgota tentativas", () => {
  const retryable = processingFailureLifecycle({
    attempt: 2,
    maxAttempts: 3,
    type: ProcessingJobType.CONTEXT_REANALYSIS,
  });
  const exhausted = processingFailureLifecycle({
    attempt: 3,
    maxAttempts: 3,
    type: ProcessingJobType.CONTEXT_REANALYSIS,
  });

  assert.equal(retryable.noteStatus, NoteStatus.PROCESSING);
  assert.equal(retryable.noteStage, ProcessingStage.ANALYZING);
  assert.equal(retryable.contextSubmissionStatus, null);
  assert.equal(exhausted.noteStatus, NoteStatus.FAILED);
  assert.equal(exhausted.noteStage, ProcessingStage.FAILED);
  assert.equal(
    exhausted.contextSubmissionStatus,
    ContextSubmissionStatus.REANALYSIS_FAILED,
  );
  assert.equal(
    ACTIVE_CONTEXT_SUBMISSION_STATUSES.includes(
      ContextSubmissionStatus.REANALYSIS_FAILED as never,
    ),
    false,
  );
});

test("normaliza limites do worker para uma execução segura", () => {
  const options = normalizeProcessingWorkerOptions({
    batchSize: 99,
    leaseTimeoutMs: 60 * 60 * 1_000,
    maxRuntimeMs: 999_999,
    workerId: "worker-test",
  });

  assert.equal(options.batchSize, 3);
  assert.equal(options.leaseTimeoutMs, 30 * 60 * 1_000);
  assert.equal(options.maxRuntimeMs, 250 * 1_000);
  assert.equal(options.workerId, "worker-test");
});

test("recupera leases antes de consumir a fila e respeita o lote", async () => {
  const pending = ["job-1", "job-2", "job-3"];
  const processed: string[] = [];
  let recoveryCalled = false;

  const result = await drainProcessingQueue(
    { batchSize: 2, workerId: "worker-test" },
    {
      findNextJobId: async () => pending.shift() ?? null,
      processJob: async (jobId) => {
        assert.equal(recoveryCalled, true);
        processed.push(jobId);
      },
      recoverExpiredLeases: async () => {
        recoveryCalled = true;
        return { completed: 0, exhausted: 0, recovered: 1, scanned: 1 };
      },
    },
  );

  assert.deepEqual(processed, ["job-1", "job-2"]);
  assert.equal(result.processed, 2);
  assert.deepEqual(result.recovery, {
    completed: 0,
    exhausted: 0,
    recovered: 1,
    scanned: 1,
  });
});

test("uma falha fica registrada sem impedir o próximo job do lote", async () => {
  const pending = ["job-falhou", "job-ok"];

  const result = await drainProcessingQueue(
    { batchSize: 2, workerId: "worker-test" },
    {
      findNextJobId: async () => pending.shift() ?? null,
      processJob: async (jobId) => {
        if (jobId === "job-falhou") {
          throw Object.assign(new Error("falha simulada"), {
            code: "EXTRACTION_TIMEOUT",
          });
        }
      },
      recoverExpiredLeases: async () => ({
        completed: 0,
        exhausted: 0,
        recovered: 0,
        scanned: 0,
      }),
    },
  );

  assert.deepEqual(result.executions, [
    {
      errorCode: "EXTRACTION_TIMEOUT",
      jobId: "job-falhou",
      status: "failed",
    },
    { jobId: "job-ok", status: "succeeded" },
  ]);
});

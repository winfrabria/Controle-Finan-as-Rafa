import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import { ProcessingJobType, ProcessingStage, NoteStatus } from "@/generated/prisma/enums";
import { runClaimedProcessingJobPipeline } from "./processing-jobs";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("três jobs concorrentes preservam noteId, jobId e estado sem mistura", async () => {
  const jobs = [
    { id: "job-concurrent-1", noteId: "note-concurrent-1", contextSubmissionId: null, type: ProcessingJobType.FULL_AUDIT },
    { id: "job-concurrent-2", noteId: "note-concurrent-2", contextSubmissionId: null, type: ProcessingJobType.FULL_AUDIT },
    { id: "job-concurrent-3", noteId: "note-concurrent-3", contextSubmissionId: null, type: ProcessingJobType.FULL_AUDIT },
  ];
  const expectedJobByNote = new Map(jobs.map((job) => [job.noteId, job.id]));
  type TestState = {
    extractedData: unknown;
    failureCode: string | null;
    processingStage: ProcessingStage;
    status: NoteStatus;
  };
  const states = new Map<string, TestState>(
    jobs.map((job): [string, TestState] => [
      job.noteId,
      {
        extractedData: null,
        failureCode: null,
        processingStage: ProcessingStage.RECEIVED,
        status: NoteStatus.RECEIVED,
      },
    ]),
  );
  const extractionCalls: Array<{ jobId: string; noteId: string }> = [];
  const auditCalls: Array<{ jobId: string; noteId: string }> = [];
  let activeExtractions = 0;
  let maxActiveExtractions = 0;
  let enteredExtractions = 0;
  let releaseBarrier!: () => void;
  const extractionBarrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });

  await Promise.all(
    jobs.map((job) =>
      runClaimedProcessingJobPipeline(job, {
        findNoteState: async (noteId) => {
          const state = states.get(noteId);
          assert.ok(state, `estado ausente para ${noteId}`);
          return state;
        },
        markAuditStarted: async () => {
          throw new Error("nenhum job deveria pular a extração neste cenário");
        },
        processExtraction: async (noteId, options) => {
          const jobId = options?.processingJobId;
          assert.equal(jobId, expectedJobByNote.get(noteId));
          assert.ok(jobId);
          extractionCalls.push({ jobId, noteId });
          activeExtractions += 1;
          maxActiveExtractions = Math.max(maxActiveExtractions, activeExtractions);
          enteredExtractions += 1;
          if (enteredExtractions === jobs.length) releaseBarrier();
          await extractionBarrier;
          await tick();
          const state = states.get(noteId);
          assert.ok(state);
          assert.equal(state.extractedData, null);
          state.extractedData = { ownerNoteId: noteId, ownerJobId: jobId };
          state.processingStage = ProcessingStage.ANALYZING;
          state.status = NoteStatus.PROCESSING;
          activeExtractions -= 1;
          return { id: noteId } as never;
        },
        processAudit: async (noteId, options) => {
          const jobId = options?.processingJobId;
          assert.equal(jobId, expectedJobByNote.get(noteId));
          assert.ok(jobId);
          const state = states.get(noteId);
          assert.ok(state);
          assert.deepEqual(state.extractedData, {
            ownerNoteId: noteId,
            ownerJobId: jobId,
          });
          auditCalls.push({ jobId, noteId });
          return { id: noteId } as never;
        },
      }),
    ),
  );

  assert.equal(maxActiveExtractions, 3);
  assert.deepEqual(
    extractionCalls.sort((left, right) => left.noteId.localeCompare(right.noteId)),
    jobs
      .map((job) => ({ jobId: job.id, noteId: job.noteId }))
      .sort((left, right) => left.noteId.localeCompare(right.noteId)),
  );
  assert.deepEqual(
    auditCalls.sort((left, right) => left.noteId.localeCompare(right.noteId)),
    jobs
      .map((job) => ({ jobId: job.id, noteId: job.noteId }))
      .sort((left, right) => left.noteId.localeCompare(right.noteId)),
  );
  for (const job of jobs) {
    const state = states.get(job.noteId);
    assert.deepEqual(state?.extractedData, {
      ownerNoteId: job.noteId,
      ownerJobId: job.id,
    });
    assert.equal(state?.processingStage, ProcessingStage.ANALYZING);
    assert.equal(state?.status, NoteStatus.PROCESSING);
  }
});

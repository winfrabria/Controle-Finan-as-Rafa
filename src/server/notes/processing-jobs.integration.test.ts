import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import { NoteStatus, ProcessingJobStatus, ProcessingStage } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { claimProcessingJob, scheduleNoteReprocess } from "./processing-jobs";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";

test("claim otimista permite somente um worker", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const work = await prisma.work.create({ data: { code: `HARNESS-${suffix}`, name: "Harness test" } });
  try {
    const note = await prisma.note.create({ data: {
      workId: work.id, originalFilePath: "test/path.pdf", originalFileName: "test.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(1),
    } });
    const job = await prisma.processingJob.create({ data: { noteId: note.id, idempotencyKey: `test:${suffix}` } });
    const claims = await Promise.allSettled([
      claimProcessingJob(job.id, "worker-a"),
      claimProcessingJob(job.id, "worker-b"),
    ]);
    assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  } finally {
    await prisma.note.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
  }
});

test("reprocessamento preserva histórico e cria novo job", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const work = await prisma.work.create({ data: { code: `REPROCESS-${suffix}`, name: "Reprocess test" } });
  try {
    const note = await prisma.note.create({ data: {
      workId: work.id, originalFilePath: "test/path.pdf", originalFileName: "test.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(1),
      status: NoteStatus.OK, processingStage: ProcessingStage.COMPLETED,
    } });
    const job = await scheduleNoteReprocess(note.id);
    const refreshed = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(job.status, ProcessingJobStatus.PENDING);
    assert.equal(refreshed.status, NoteStatus.RECEIVED);
    assert.equal(refreshed.processingStage, ProcessingStage.RECEIVED);
  } finally {
    await prisma.note.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
  }
});

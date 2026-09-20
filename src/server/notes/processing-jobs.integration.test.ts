import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextSubmissionStatus,
  NoteStatus,
  ProcessingJobStatus,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { claimProcessingJob, scheduleNoteReprocess } from "./processing-jobs";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";
import { recordNoteRead } from "./record-note-read";
import { loadNoteDetail } from "@/features/note-detail/data/load-note-detail";
import { randomUUID } from "node:crypto";
import { getStorageAdminClient } from "@/server/storage/admin-client";
import { drainProcessingQueue } from "./processing-worker";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

test("leitura persiste no detalhe, rejeita versão velha e é invalidada no reprocessamento", { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const work = await prisma.work.create({ data: { code: `READ-${suffix}`, name: "Synthetic read state" } });
  let profileId: string | undefined;
  try {
    const email = `read-${suffix}@harness.local.invalid`;
    const created = await getStorageAdminClient().auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
    assert.equal(created.error, null);
    assert.ok(created.data.user);
    profileId = created.data.user.id;
    const profile = await prisma.profile.upsert({ where: { id: profileId },
      create: { id: profileId, email, role: "REVIEWER" }, update: { role: "REVIEWER" } });
    const note = await prisma.note.create({ data: {
      workId: work.id, originalFilePath: "test/read-state.pdf", originalFileName: "synthetic-read.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(1),
      publicProtocol: `TEST-READ-${suffix}`, publicTokenHash: "f".repeat(64), publicTokenExpiresAt: new Date(0),
      status: NoteStatus.OK, processingStage: ProcessingStage.COMPLETED, auditResult: "OK", processedAt: new Date(),
    } });
    assert.equal((await loadNoteDetail({ id: note.id, role: "REVIEWER", viewerId: profile.id }))?.isRead, false);
    await recordNoteRead(note.id, profile.id, note.version);
    const detail = await loadNoteDetail({ id: note.id, role: "REVIEWER", viewerId: profile.id });
    assert.equal(detail?.isRead, true);
    assert.equal(detail?.version, note.version);
    assert.equal((await loadNoteDetail({ id: note.id, role: "REVIEWER" }))?.isRead, false);
    await assert.rejects(recordNoteRead(note.id, profile.id, note.version + 1), { code: "ANALISE_ALTERADA" });
    assert.equal(await prisma.noteRead.count({ where: { noteId: note.id } }), 1);
    await scheduleNoteReprocess(note.id);
    assert.equal((await loadNoteDetail({ id: note.id, role: "REVIEWER", viewerId: profile.id }))?.isRead, false);
    await assert.rejects(recordNoteRead(note.id, profile.id, note.version), { code: "ANALISE_ALTERADA" });
    await assert.rejects(recordNoteRead(note.id, profile.id), { code: "ANALISE_EM_ANDAMENTO" });
    assert.equal(await prisma.noteRead.count({ where: { noteId: note.id } }), 0);
  } finally {
    await prisma.note.deleteMany({ where: { workId: work.id } });
    if (profileId) {
      await prisma.profile.deleteMany({ where: { id: profileId } });
      const removed = await getStorageAdminClient().auth.admin.deleteUser(profileId);
      assert.equal(removed.error, null);
    }
    await prisma.work.delete({ where: { id: work.id } });
  }
});

test("claim otimista permite somente um worker", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const work = await prisma.work.create({ data: { code: `HARNESS-${suffix}`, name: "Harness test" } });
  try {
    const note = await prisma.note.create({ data: {
      workId: work.id, originalFilePath: "test/path.pdf", originalFileName: "test.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(1),
      publicProtocol: `TEST-${suffix}-1`, publicTokenHash: "a".repeat(64), publicTokenExpiresAt: new Date(0),
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
      publicProtocol: `TEST-${suffix}-2`, publicTokenHash: "b".repeat(64), publicTokenExpiresAt: new Date(0),
      status: NoteStatus.OK, processingStage: ProcessingStage.COMPLETED,
    } });
    const job = await scheduleNoteReprocess(note.id);
    const refreshed = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(job.status, ProcessingJobStatus.PENDING);
    assert.equal(refreshed.status, NoteStatus.RECEIVED);
    assert.equal(refreshed.processingStage, ProcessingStage.RECEIVED);
    assert.notEqual(refreshed.publicTokenHash, "b".repeat(64));
    assert.equal(refreshed.publicTokenExpiresAt.getTime(), 0);
  } finally {
    await prisma.note.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
  }
});

test(
  "reanálise esgotada não bloqueia reprocessamento administrativo",
  { skip: !enabled },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const work = await prisma.work.create({
      data: { code: `REANALYSIS-${suffix}`, name: "Reanalysis test" },
    });
    try {
      const note = await prisma.note.create({
        data: {
          workId: work.id,
          originalFilePath: "test/path.pdf",
          originalFileName: "test.pdf",
          originalMimeType: "application/pdf",
          originalSizeBytes: BigInt(1),
          publicProtocol: `TEST-${suffix}-3`,
          publicTokenHash: "c".repeat(64),
          publicTokenExpiresAt: new Date(0),
          status: NoteStatus.FAILED,
          processingStage: ProcessingStage.FAILED,
          contextRound: 1,
        },
      });
      await prisma.noteContextSubmission.create({
        data: {
          answerFingerprint: "d".repeat(64),
          idempotencyKey: `context:${suffix}`,
          noteId: note.id,
          round: 1,
          status: ContextSubmissionStatus.REANALYSIS_FAILED,
          reanalysisCompletedAt: new Date(),
        },
      });

      const job = await scheduleNoteReprocess(note.id);
      assert.equal(job.status, ProcessingJobStatus.PENDING);
    } finally {
      await prisma.note.deleteMany({ where: { workId: work.id } });
      await prisma.work.delete({ where: { id: work.id } });
    }
  },
);

test("admin pode substituir rodada aguardando contexto, mas não processamento em execução", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const work = await prisma.work.create({ data: { code: `WAIT-CONTEXT-${suffix}`, name: "Synthetic context recovery" } });
  try {
    const note = await prisma.note.create({ data: {
      workId: work.id, originalFilePath: "test/path.pdf", originalFileName: "test.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(1),
      publicProtocol: `TEST-${suffix}`, publicTokenHash: "e".repeat(64), publicTokenExpiresAt: new Date(0),
      status: NoteStatus.PROCESSING, processingStage: ProcessingStage.ANALYZING,
    } });
    await assert.rejects(scheduleNoteReprocess(note.id), { code: "REPROCESS_CONFLICT" });
    await prisma.note.update({ where: { id: note.id }, data: { processingStage: ProcessingStage.COMPLETED, auditResult: "NEEDS_CONTEXT" } });
    const job = await scheduleNoteReprocess(note.id);
    assert.equal(job.status, ProcessingJobStatus.PENDING);
    const updated = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(updated.status, NoteStatus.RECEIVED);
    assert.notEqual(updated.publicTokenHash, "e".repeat(64));
    await assert.rejects(scheduleNoteReprocess(note.id), { code: "REPROCESS_CONFLICT" });
  } finally {
    await prisma.note.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
  }
});

test("replay local não pode ser assumido pelo worker comum nem ganhar repetição automática", { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const work = await prisma.work.create({ data: { code: `MANUAL-${suffix}`, name: "Isolated manual job" } });
  try {
    const note = await prisma.note.create({ data: { workId: work.id, originalFilePath: "test/manual.pdf",
      originalFileName: "manual.pdf", originalMimeType: "application/pdf", originalSizeBytes: BigInt(1),
      publicProtocol: `TEST-MANUAL-${suffix}`, publicTokenHash: "b".repeat(64), publicTokenExpiresAt: new Date(0),
      status: NoteStatus.OK, processingStage: ProcessingStage.COMPLETED } });
    const workerId = `snapshot-reaudit:${suffix}`;
    const job = await scheduleNoteReprocess(note.id, { isolatedManualWorkerId: workerId });
    const before = await prisma.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(before.maxAttempts, 1);
    const selected: string[] = [];
    await drainProcessingQueue({ batchSize: 1 }, { processJob: async id => { selected.push(id); },
      recoverExpiredLeases: async () => ({ completed: 0, exhausted: 0, recovered: 0, scanned: 0 }) });
    assert.equal(selected.includes(job.id), false, "The manual job must not starve the normal queue.");
    await assert.rejects(claimProcessingJob(job.id, "background-worker"), { code: "JOB_NOT_CLAIMABLE" });
    assert.deepEqual(await prisma.processingJob.findUniqueOrThrow({ where: { id: job.id } }), before);
    assert.equal((await claimProcessingJob(job.id, workerId)).attempt, 1);
    await prisma.processingJob.update({ where: { id: job.id }, data: { status: "FAILED", lockedBy: null } });
    await assert.rejects(claimProcessingJob(job.id, workerId), { code: "JOB_NOT_CLAIMABLE" });
  } finally {
    await prisma.note.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
  }
});

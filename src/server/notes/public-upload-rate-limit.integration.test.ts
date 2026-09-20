import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { NoteStatus, ProcessingStage } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

import { createNoteUpload } from "./create-note-upload";
import { NoteUploadError } from "./note-upload-error";
import { enforcePublicUploadRateLimit } from "./public-upload-rate-limit";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => {
  await prisma.$disconnect();
});

function noteData(workId: string, suffix: string, createdAt = new Date()) {
  return {
    createdAt,
    originalFileName: "rate-limit.png",
    originalFilePath: `test/rate-limit-${suffix}.png`,
    originalMimeType: "image/png",
    originalSizeBytes: BigInt(8),
    processingStage: ProcessingStage.RECEIVED,
    publicProtocol: `RATE-${suffix}`,
    publicTokenExpiresAt: new Date(0),
    publicTokenHash: "a".repeat(64),
    status: NoteStatus.RECEIVED,
    workId,
  };
}

test(
  "lock transacional impede estouro concorrente do limite por obra",
  { skip: !enabled },
  async () => {
    const suffix = randomUUID();
    const work = await prisma.work.create({
      data: { code: `RATE-${suffix}`, name: "Rate limit concurrency" },
    });
    const now = new Date();
    try {
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, (_, index) =>
          prisma.$transaction(async (transaction) => {
            await enforcePublicUploadRateLimit(transaction, {
              config: {
                globalLimit: 10_000,
                perWorkLimit: 2,
                windowSeconds: 3_600,
              },
              now,
              workId: work.id,
            });
            return transaction.note.create({
              data: noteData(work.id, `${suffix}-${index}`, now),
            });
          }),
        ),
      );
      assert.equal(
        attempts.filter((attempt) => attempt.status === "fulfilled").length,
        2,
        attempts
          .map((attempt) =>
            attempt.status === "fulfilled"
              ? "fulfilled"
              : attempt.reason instanceof Error
                ? `${attempt.reason.name}: ${attempt.reason.message}`
                : String(attempt.reason),
          )
          .join(" | "),
      );
      for (const attempt of attempts.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )) {
        assert.ok(attempt.reason instanceof NoteUploadError);
        assert.equal(attempt.reason.code, "LIMITE_DE_ENVIOS_ATINGIDO");
      }
      assert.equal(await prisma.note.count({ where: { workId: work.id } }), 2);
    } finally {
      await prisma.note.deleteMany({ where: { workId: work.id } });
      await prisma.work.delete({ where: { id: work.id } });
    }
  },
);

test(
  "429 não cria nota, evento, job nem alcança o Storage",
  { skip: !enabled },
  async () => {
    const suffix = randomUUID();
    const work = await prisma.work.create({
      data: { code: `RATE-UPLOAD-${suffix}`, name: "Rate limit upload" },
    });
    const seed = await prisma.note.create({ data: noteData(work.id, suffix) });
    const previous = {
      global: process.env.PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL,
      perWork: process.env.PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK,
      window: process.env.PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
    };
    process.env.PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL = "10000";
    process.env.PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK = "1";
    process.env.PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = "3600";
    try {
      const before = {
        events: await prisma.noteEvent.count({ where: { note: { workId: work.id } } }),
        jobs: await prisma.processingJob.count({ where: { note: { workId: work.id } } }),
        notes: await prisma.note.count({ where: { workId: work.id } }),
      };
      let attachmentRead = false;
      await assert.rejects(
        createNoteUpload({
          bytes: async () => {
            attachmentRead = true;
            return Uint8Array.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]);
          },
          contentType: "image/png",
          fileName: "rate-limit.png",
          workId: work.id,
        }),
        (error: unknown) => {
          assert.ok(
            error instanceof NoteUploadError,
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
          );
          assert.equal(error.code, "LIMITE_DE_ENVIOS_ATINGIDO");
          assert.equal(error.httpStatus, 429);
          return true;
        },
      );
      assert.equal(
        attachmentRead,
        false,
        "a cota deve rejeitar antes de copiar ou interpretar o anexo",
      );
      assert.deepEqual(
        {
          events: await prisma.noteEvent.count({ where: { note: { workId: work.id } } }),
          jobs: await prisma.processingJob.count({ where: { note: { workId: work.id } } }),
          notes: await prisma.note.count({ where: { workId: work.id } }),
        },
        before,
      );
    } finally {
      if (previous.global === undefined) delete process.env.PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL;
      else process.env.PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL = previous.global;
      if (previous.perWork === undefined) delete process.env.PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK;
      else process.env.PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK = previous.perWork;
      if (previous.window === undefined) delete process.env.PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS;
      else process.env.PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = previous.window;
      await prisma.note.deleteMany({ where: { workId: work.id } });
      await prisma.work.delete({ where: { id: work.id } });
    }
    assert.ok(seed.id);
  },
);

import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@/generated/prisma/client";

import { NoteUploadError } from "./note-upload-error";
import {
  DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL,
  DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK,
  DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
  enforcePublicUploadRateLimit,
  getPublicUploadRateLimitConfig,
} from "./public-upload-rate-limit";

function fakeTransaction(input: {
  globalCount: number;
  oldest?: Date;
  workCount: number;
}) {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock");
      return [];
    },
    note: {
      count: async (query: { where: { workId?: string } }) => {
        const scope = query.where.workId ? "work" : "global";
        calls.push(`count:${scope}`);
        return query.where.workId ? input.workCount : input.globalCount;
      },
      findFirst: async (query: { where: { workId?: string } }) => {
        const scope = query.where.workId ? "work" : "global";
        calls.push(`oldest:${scope}`);
        return input.oldest ? { createdAt: input.oldest } : null;
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { calls, transaction };
}

test("configuração aplica limites seguros por padrão", () => {
  assert.deepEqual(getPublicUploadRateLimitConfig({} as NodeJS.ProcessEnv), {
    globalLimit: DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL,
    perWorkLimit: DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK,
    windowSeconds: DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
  });
});

test("configuração falha fechada para zero, negativos e valores excessivos", () => {
  for (const environment of [
    { PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL: "0" },
    { PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK: "-1" },
    { PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS: "86401" },
  ]) {
    assert.throws(
      () =>
        getPublicUploadRateLimitConfig(
          environment as unknown as NodeJS.ProcessEnv,
        ),
      /must be an integer between 1 and/,
    );
  }
});

test("upload abaixo dos dois limites passa após adquirir o lock", async () => {
  const { calls, transaction } = fakeTransaction({
    globalCount: 4,
    workCount: 2,
  });
  await enforcePublicUploadRateLimit(transaction, {
    config: { globalLimit: 5, perWorkLimit: 3, windowSeconds: 60 },
    now: new Date("2026-09-20T03:00:00.000Z"),
    workId: "work-a",
  });
  assert.deepEqual(calls, ["lock", "count:global", "count:work"]);
});

test("limite global rejeita antes de consultar ou criar o escopo da obra", async () => {
  const now = new Date("2026-09-20T03:00:00.000Z");
  const { calls, transaction } = fakeTransaction({
    globalCount: 5,
    oldest: new Date("2026-09-20T02:59:30.000Z"),
    workCount: 0,
  });
  await assert.rejects(
    enforcePublicUploadRateLimit(transaction, {
      config: { globalLimit: 5, perWorkLimit: 3, windowSeconds: 60 },
      now,
      workId: "work-a",
    }),
    (error: unknown) => {
      assert.ok(error instanceof NoteUploadError);
      assert.equal(error.code, "LIMITE_DE_ENVIOS_ATINGIDO");
      assert.equal(error.httpStatus, 429);
      assert.equal(error.retryAfterSeconds, 30);
      return true;
    },
  );
  assert.deepEqual(calls, ["lock", "count:global", "oldest:global"]);
});

test("limite por obra rejeita sem depender do limite global", async () => {
  const { calls, transaction } = fakeTransaction({
    globalCount: 2,
    oldest: new Date("2026-09-20T02:59:45.000Z"),
    workCount: 3,
  });
  await assert.rejects(
    enforcePublicUploadRateLimit(transaction, {
      config: { globalLimit: 5, perWorkLimit: 3, windowSeconds: 60 },
      now: new Date("2026-09-20T03:00:00.000Z"),
      workId: "work-a",
    }),
    (error: unknown) => {
      assert.ok(error instanceof NoteUploadError);
      assert.equal(error.retryAfterSeconds, 45);
      return true;
    },
  );
  assert.deepEqual(calls, [
    "lock",
    "count:global",
    "count:work",
    "oldest:work",
  ]);
});

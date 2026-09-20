import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { NoteUploadError } from "@/server/notes/note-upload-error";

export const DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
export const DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL = 120;
export const DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK = 30;

const MAX_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_UPLOAD_LIMIT = 10_000;

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

export type PublicUploadRateLimitConfig = ReturnType<
  typeof getPublicUploadRateLimitConfig
>;

export function getPublicUploadRateLimitConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return {
    globalLimit: positiveInteger(
      environment.PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL,
      DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL,
      "PUBLIC_UPLOAD_RATE_LIMIT_GLOBAL",
      MAX_UPLOAD_LIMIT,
    ),
    perWorkLimit: positiveInteger(
      environment.PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK,
      DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK,
      "PUBLIC_UPLOAD_RATE_LIMIT_PER_WORK",
      MAX_UPLOAD_LIMIT,
    ),
    windowSeconds: positiveInteger(
      environment.PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS,
      "PUBLIC_UPLOAD_RATE_LIMIT_WINDOW_SECONDS",
      MAX_WINDOW_SECONDS,
    ),
  } as const;
}

async function retryAfterSeconds(
  transaction: Prisma.TransactionClient,
  input: {
    cutoff: Date;
    now: Date;
    windowSeconds: number;
    workId?: string;
  },
) {
  const oldest = await transaction.note.findFirst({
    where: {
      createdAt: { gte: input.cutoff },
      ...(input.workId ? { workId: input.workId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!oldest) return input.windowSeconds;
  return Math.max(
    1,
    Math.ceil(
      (oldest.createdAt.getTime() + input.windowSeconds * 1_000 - input.now.getTime()) /
        1_000,
    ),
  );
}

function limitError(retryAfter: number) {
  return new NoteUploadError(
    "LIMITE_DE_ENVIOS_ATINGIDO",
    429,
    "Muitos anexos foram enviados recentemente. Aguarde alguns minutos e tente novamente.",
    { retryAfterSeconds: retryAfter },
  );
}

export async function enforcePublicUploadRateLimit(
  transaction: Prisma.TransactionClient,
  input: {
    config?: PublicUploadRateLimitConfig;
    now?: Date;
    workId: string;
  },
) {
  const config = input.config ?? getPublicUploadRateLimitConfig();
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - config.windowSeconds * 1_000);

  // PostgreSQL transaction-scoped advisory lock: every application instance
  // makes the count-and-create decision in the same order. The caller creates
  // the Note in this transaction, so concurrent uploads cannot overrun a cap.
  await transaction.$queryRaw`
    SELECT 1::integer AS acquired
    FROM pg_advisory_xact_lock(1464421958, 1431323732)
  `;

  const globalCount = await transaction.note.count({
    where: { createdAt: { gte: cutoff } },
  });
  if (globalCount >= config.globalLimit) {
    throw limitError(
      await retryAfterSeconds(transaction, {
        cutoff,
        now,
        windowSeconds: config.windowSeconds,
      }),
    );
  }

  const workCount = await transaction.note.count({
    where: { createdAt: { gte: cutoff }, workId: input.workId },
  });
  if (workCount >= config.perWorkLimit) {
    throw limitError(
      await retryAfterSeconds(transaction, {
        cutoff,
        now,
        windowSeconds: config.windowSeconds,
        workId: input.workId,
      }),
    );
  }
}

import { NextResponse } from "next/server";

import { HARNESS_MODEL, HARNESS_VERSIONS } from "@/lib/audit-harness";
import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000);
  const [pending, failed, stale, recentRuns, lastRun, recentErrors] = await prisma.$transaction([
    prisma.processingJob.count({ where: { status: "PENDING" } }),
    prisma.processingJob.count({ where: { status: "FAILED" } }),
    prisma.processingJob.count({ where: { status: "RUNNING", lockedAt: { lt: staleBefore } } }),
    prisma.aiRun.aggregate({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
      _count: true,
      _sum: { costUsd: true, totalTokens: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        completedAt: true,
        createdAt: true,
        errorCode: true,
        latencyMs: true,
        status: true,
      },
    }),
    prisma.aiRun.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
        status: "FAILED",
      },
    }),
  ]);

  const openRouterConfigured = Boolean(
    process.env.OPENROUTER_API_KEY ?? process.env.OpenRouter_API_Key,
  );
  const storageConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_STORAGE_BUCKET,
  );

  return NextResponse.json({
    status:
      stale > 0 || !openRouterConfigured || !storageConfigured
        ? "degraded"
        : "ok",
    model: HARNESS_MODEL,
    versions: HARNESS_VERSIONS,
    services: {
      database: { status: "ok" },
      openRouter: { configured: openRouterConfigured },
      storage: { configured: storageConfigured },
    },
    jobs: { pending, failed, stale },
    lastExecution: lastRun,
    last24Hours: {
      runs: recentRuns._count,
      errors: recentErrors,
      totalTokens: recentRuns._sum.totalTokens ?? 0,
      costUsd: recentRuns._sum.costUsd?.toString() ?? "0",
      averageLatencyMs: recentRuns._avg.latencyMs ?? 0,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeProcessingWorker } from "@/server/notes/processing-worker-auth";
import { drainProcessingQueue } from "@/server/notes/processing-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function workerError(code: string, message: string, status: number) {
  return NextResponse.json(
    { erro: { codigo: code, mensagem: message } },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

async function runWorker(request: Request) {
  const authorization = authorizeProcessingWorker(
    request.headers.get("authorization"),
  );
  if (!authorization.ok) {
    return workerError(
      authorization.code,
      authorization.code === "WORKER_NOT_CONFIGURED"
        ? "O worker durável ainda não foi configurado."
        : "A chamada do worker não foi autorizada.",
      authorization.code === "WORKER_NOT_CONFIGURED" ? 503 : 401,
    );
  }

  const requestId = randomUUID();
  const url = new URL(request.url);
  const batchSize = Number(url.searchParams.get("limit") ?? "1");

  try {
    const result = await drainProcessingQueue({
      batchSize,
      workerId: `scheduled:${requestId}`,
    });

    return NextResponse.json(
      {
        durationMs: result.durationMs,
        executions: result.executions,
        processed: result.processed,
        recovery: result.recovery,
        requestId,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Durable processing worker failed", {
      message: error instanceof Error ? error.message : "unknown error",
      requestId,
    });
    return workerError(
      "WORKER_FAILED",
      "O worker não pôde concluir esta execução.",
      500,
    );
  }
}

export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}

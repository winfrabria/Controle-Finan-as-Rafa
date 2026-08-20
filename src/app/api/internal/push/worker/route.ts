import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeProcessingWorker } from "@/server/notes/processing-worker-auth";
import { dispatchPendingPushDeliveries } from "@/server/push/delivery-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

async function run(request: Request) {
  const authorization = authorizeProcessingWorker(
    request.headers.get("authorization"),
  );
  if (!authorization.ok) {
    return NextResponse.json(
      {
        erro: {
          codigo: authorization.code,
          mensagem: "A chamada do worker não foi autorizada.",
        },
      },
      { status: authorization.code === "WORKER_NOT_CONFIGURED" ? 503 : 401 },
    );
  }

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "12", 10);
  const result = await dispatchPendingPushDeliveries({ batchSize: limit });
  return NextResponse.json({ ...result, requestId: randomUUID() });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

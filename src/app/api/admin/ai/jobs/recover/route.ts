import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { persistAdminAudit } from "@/server/notes/admin-audit-log";
import {
  getProcessingQueueRecoveryPreview,
  scheduleOrphanedNotesForRecovery,
} from "@/server/notes/processing-worker";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  const preview = await getProcessingQueueRecoveryPreview();
  return NextResponse.json(preview, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        erro: {
          codigo: "RECOVERY_BODY_INVALID",
          mensagem: "Informe os anexos que devem voltar para a fila.",
        },
      },
      { status: 400 },
    );
  }

  const input = body as { confirm?: unknown; noteIds?: unknown };
  const noteIds = Array.isArray(input.noteIds)
    ? input.noteIds.filter(
        (noteId): noteId is string =>
          typeof noteId === "string" && UUID_PATTERN.test(noteId),
      )
    : [];

  if (input.confirm !== true || noteIds.length === 0 || noteIds.length > 25) {
    return NextResponse.json(
      {
        erro: {
          codigo: "RECOVERY_CONFIRMATION_REQUIRED",
          mensagem:
            "Confirme explicitamente de 1 a 25 anexos para agendar a recuperação.",
        },
      },
      { status: 400 },
    );
  }

  const result = await scheduleOrphanedNotesForRecovery(noteIds);
  const requestId = randomUUID();
  await persistAdminAudit({
    action: "ai.queue.orphans.scheduled",
    actorEmail: auth.profile.email,
    actorId: auth.profile.id,
    changes: {
      requestedNoteIds: noteIds,
      scheduledNoteIds: result.scheduled,
      skippedNoteIds: result.skipped,
    },
    entityType: "processing_queue",
    requestId,
  });

  return NextResponse.json(
    { ...result, requestId },
    {
      status: result.scheduled.length > 0 ? 202 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

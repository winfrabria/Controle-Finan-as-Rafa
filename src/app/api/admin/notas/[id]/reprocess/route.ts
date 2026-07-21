import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";

import { persistAdminAudit } from "@/server/notes/admin-audit-log";
import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import {
  processProcessingJob,
  ProcessingJobError,
  scheduleNoteReprocess,
} from "@/server/notes/processing-jobs";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const requestId = randomUUID();
  try {
    const job = await scheduleNoteReprocess(id);
    await persistAdminAudit({
      action: "note.reprocess.scheduled",
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      entityId: id,
      entityType: "note",
      requestId,
      changes: { jobId: job.id },
    });
    after(async () => {
      try {
        await processProcessingJob(job.id, {
          workerId: `reprocess:${requestId}`,
        });
      } catch (error) {
        console.error("Background note reprocessing failed", {
          jobId: job.id,
          message: error instanceof Error ? error.message : "unknown error",
          noteId: id,
          requestId,
        });
      }
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof ProcessingJobError) {
      return NextResponse.json({ erro: { codigo: error.code, mensagem: error.message } }, { status: error.code === "NOTE_NOT_FOUND" ? 404 : 409 });
    }
    return NextResponse.json({ erro: { codigo: "REPROCESS_FAILED", mensagem: "Não foi possível agendar o reprocessamento." } }, { status: 500 });
  }
}

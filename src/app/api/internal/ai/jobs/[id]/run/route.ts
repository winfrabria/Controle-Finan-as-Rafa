import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { persistAdminAudit } from "@/server/notes/admin-audit-log";
import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { ProcessingJobError, processProcessingJob } from "@/server/notes/processing-jobs";

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
    const result = await processProcessingJob(id, { workerId: `admin:${auth.profile.id}:${requestId}` });
    await persistAdminAudit({
      action: "ai.job.executed",
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      entityId: id,
      entityType: "processing_job",
      requestId,
      changes: { noteId: result.note.id, status: result.note.status },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProcessingJobError) {
      return NextResponse.json({ erro: { codigo: error.code, mensagem: error.message } }, { status: error.code === "JOB_NOT_FOUND" ? 404 : 409 });
    }
    return NextResponse.json({ erro: { codigo: "PIPELINE_FAILED", mensagem: "O processamento não pôde ser concluído." } }, { status: 502 });
  }
}

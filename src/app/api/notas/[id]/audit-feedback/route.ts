import { NextResponse } from "next/server";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { isSameOriginMutation } from "@/server/http/same-origin";
import {
  AuditFeedbackError,
  recordAuditFeedback,
} from "@/server/notes/audit-feedback";
import { auditFeedbackInputSchema } from "@/server/notes/audit-feedback-contract";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { erro: { codigo: "ORIGEM_INVALIDA", mensagem: "Origem inválida." } },
      { status: 403 },
    );
  }
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_INVALIDA", mensagem: "Nota inválida." } },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { erro: { codigo: "JSON_INVALIDO", mensagem: "Corpo inválido." } },
      { status: 400 },
    );
  }
  const parsed = auditFeedbackInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        erro: {
          codigo: "AUDIT_FEEDBACK_INVALID",
          mensagem: "Revise o tipo, o motivo e o comentário do feedback.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const feedback = await recordAuditFeedback({
      actorEmail: access.profile.email,
      actorId: access.profile.id,
      comment: parsed.data.comment,
      noteId: id,
      noteVersion: parsed.data.noteVersion,
      reasonCode: parsed.data.reasonCode,
      verdict: parsed.data.verdict,
    });
    return NextResponse.json({ feedback });
  } catch (error) {
    if (error instanceof AuditFeedbackError) {
      const status =
        error.code === "NOTE_NOT_FOUND"
          ? 404
          : error.code === "AUDIT_FEEDBACK_VERSION_CONFLICT"
            ? 409
            : error.code === "AUDIT_FEEDBACK_NOT_ALLOWED"
              ? 409
              : 400;
      return NextResponse.json(
        { erro: { codigo: error.code, mensagem: error.message } },
        { status },
      );
    }
    throw error;
  }
}

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  AiRunKind,
  AiRunStatus,
  AuditFeedbackStatus,
  AuditFeedbackVerdict,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { sanitizeForPersistence } from "@/lib/audit-harness";
import { prisma } from "@/server/db/prisma";
import {
  AUDIT_FEEDBACK_REASON_CODES,
  auditFeedbackInputSchema,
} from "@/server/notes/audit-feedback-contract";

export class AuditFeedbackError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AuditFeedbackError";
  }
}

function toJson(value: unknown) {
  return sanitizeForPersistence(value) as Prisma.InputJsonValue;
}

export async function recordAuditFeedback(input: {
  actorEmail: string;
  actorId: string;
  comment?: string | null;
  noteId: string;
  noteVersion: number;
  reasonCode: string;
  verdict: keyof typeof AUDIT_FEEDBACK_REASON_CODES;
}) {
  const parsed = auditFeedbackInputSchema.safeParse({
    comment: input.comment ?? null,
    noteVersion: input.noteVersion,
    reasonCode: input.reasonCode,
    verdict: input.verdict,
  });
  if (!parsed.success) {
    throw new AuditFeedbackError(
      "AUDIT_FEEDBACK_INVALID",
      "O feedback informado não atende ao contrato.",
    );
  }
  const sanitizedComment = parsed.data.comment
    ? sanitizeForPersistence(parsed.data.comment)
    : null;
  const safeComment =
    typeof sanitizedComment === "string" ? sanitizedComment : null;

  return prisma.$transaction(async (transaction) => {
    const note = await transaction.note.findUnique({
      where: { id: input.noteId },
      select: { id: true, processingStage: true, version: true },
    });
    if (!note) {
      throw new AuditFeedbackError("NOTE_NOT_FOUND", "Nota não encontrada.");
    }
    if (
      note.processingStage !== ProcessingStage.COMPLETED ||
      note.version !== parsed.data.noteVersion
    ) {
      throw new AuditFeedbackError(
        "AUDIT_FEEDBACK_VERSION_CONFLICT",
        "O diagnóstico mudou. Atualize a página antes de enviar o feedback.",
      );
    }

    const aiRun = await transaction.aiRun.findFirst({
      where: {
        kind: AiRunKind.AUDIT,
        noteId: note.id,
        status: AiRunStatus.SUCCEEDED,
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!aiRun) {
      throw new AuditFeedbackError(
        "AUDIT_FEEDBACK_NOT_ALLOWED",
        "Esta nota não possui uma auditoria concluída para receber feedback.",
      );
    }

    const existing = await transaction.auditFeedback.findUnique({
      where: {
        noteId_noteVersion_actorId: {
          actorId: input.actorId,
          noteId: note.id,
          noteVersion: note.version,
        },
      },
      select: {
        aiRunId: true,
        comment: true,
        id: true,
        reasonCode: true,
        verdict: true,
      },
    });
    const samePayload =
      existing?.aiRunId === aiRun.id &&
      existing.verdict === parsed.data.verdict &&
      existing.reasonCode === parsed.data.reasonCode &&
      (existing.comment ?? null) === safeComment;
    if (existing && samePayload) {
      return transaction.auditFeedback.findUniqueOrThrow({
        where: { id: existing.id },
        select: {
          comment: true,
          createdAt: true,
          id: true,
          noteVersion: true,
          reasonCode: true,
          status: true,
          updatedAt: true,
          verdict: true,
        },
      });
    }

    const feedback = await transaction.auditFeedback.upsert({
      where: {
        noteId_noteVersion_actorId: {
          actorId: input.actorId,
          noteId: note.id,
          noteVersion: note.version,
        },
      },
      create: {
        actorId: input.actorId,
        aiRunId: aiRun.id,
        comment: safeComment,
        noteId: note.id,
        noteVersion: note.version,
        reasonCode: parsed.data.reasonCode,
        verdict: AuditFeedbackVerdict[parsed.data.verdict],
      },
      update: {
        aiRunId: aiRun.id,
        comment: safeComment,
        reasonCode: parsed.data.reasonCode,
        resolutionNote: null,
        reviewedAt: null,
        reviewedById: null,
        status: AuditFeedbackStatus.PENDING_REVIEW,
        verdict: AuditFeedbackVerdict[parsed.data.verdict],
      },
      select: {
        comment: true,
        createdAt: true,
        id: true,
        noteVersion: true,
        reasonCode: true,
        status: true,
        updatedAt: true,
        verdict: true,
      },
    });

    await transaction.noteEvent.create({
      data: {
        actorId: input.actorId,
        data: toJson({
          feedbackId: feedback.id,
          noteVersion: note.version,
          reasonCode: feedback.reasonCode,
          verdict: feedback.verdict,
        }),
        noteId: note.id,
        type: "AUDIT_FEEDBACK_RECORDED",
      },
    });
    await transaction.adminAuditLog.create({
      data: {
        action: "AUDIT_FEEDBACK_RECORDED",
        actorEmail: input.actorEmail,
        actorId: input.actorId,
        data: toJson({
          feedbackId: feedback.id,
          noteVersion: note.version,
          reasonCode: feedback.reasonCode,
          verdict: feedback.verdict,
        }),
        entityId: note.id,
        entityType: "NOTE",
      },
    });

    return feedback;
  });
}

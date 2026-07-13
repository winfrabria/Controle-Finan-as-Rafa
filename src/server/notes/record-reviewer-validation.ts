import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  FindingStatus,
  NoteClassification,
  NoteStatus,
  ValidationDecision,
} from "@/generated/prisma/enums";
import { HARNESS_VERSIONS, sanitizeForPersistence } from "@/lib/audit-harness";
import { prisma } from "@/server/db/prisma";

export type RecordReviewerValidationInput = {
  comment: string;
  decision: "OK" | "SUSPEITA";
  noteId: string;
  noteVersion: number;
  reason: string;
  reviewerId: string;
};

export async function recordReviewerValidation(
  input: RecordReviewerValidationInput,
) {
  const reviewerConfirmed = input.decision === "SUSPEITA";

  return prisma.$transaction(async (tx) => {
    const note = await tx.note.findFirst({
      where: {
        classification: NoteClassification.SUSPICIOUS,
        id: input.noteId,
        status: NoteStatus.PENDING_VALIDATION,
        version: input.noteVersion,
      },
      select: {
        findings: {
          orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
          select: {
            aiRunId: true,
            code: true,
            confidence: true,
            evidence: true,
            id: true,
            justification: true,
            policyVersion: true,
            source: true,
          },
          take: 1,
          where: {
            needsValidation: true,
            status: FindingStatus.OPEN,
          },
        },
        id: true,
      },
    });
    if (!note) return null;

    const claimed = await tx.note.updateMany({
      data: {
        status: reviewerConfirmed ? NoteStatus.REJECTED : NoteStatus.APPROVED,
        version: { increment: 1 },
      },
      where: {
        id: input.noteId,
        status: NoteStatus.PENDING_VALIDATION,
        version: input.noteVersion,
      },
    });
    if (claimed.count !== 1) return null;

    const created = await tx.validation.create({
      data: {
        aiRunId: note.findings[0]?.aiRunId ?? null,
        comment: input.comment || null,
        decision: reviewerConfirmed
          ? ValidationDecision.SUSPICION_CONFIRMED
          : ValidationDecision.FALSE_POSITIVE,
        findingId: note.findings[0]?.id ?? null,
        findingSnapshot: note.findings[0]
          ? (sanitizeForPersistence({
              ...note.findings[0],
              confidence: note.findings[0].confidence.toString(),
            }) as Prisma.InputJsonValue)
          : undefined,
        noteId: input.noteId,
        noteVersion: input.noteVersion,
        policyVersion:
          note.findings[0]?.policyVersion ?? HARNESS_VERSIONS.policy,
        reason: input.reason || "Sem motivo informado",
        validatorId: input.reviewerId,
      },
      select: { id: true },
    });

    await tx.finding.updateMany({
      data: {
        status: reviewerConfirmed
          ? FindingStatus.CONFIRMED
          : FindingStatus.FALSE_POSITIVE,
      },
      where: {
        needsValidation: true,
        noteId: input.noteId,
        status: FindingStatus.OPEN,
      },
    });

    await tx.noteEvent.create({
      data: {
        actorId: input.reviewerId,
        data: {
          comment: input.comment || null,
          decision: input.decision,
          reason: input.reason || null,
          validationId: created.id,
        },
        fromStatus: NoteStatus.PENDING_VALIDATION,
        noteId: input.noteId,
        toStatus: reviewerConfirmed ? NoteStatus.REJECTED : NoteStatus.APPROVED,
        type: "VALIDATION_RECORDED",
      },
    });

    return created;
  });
}

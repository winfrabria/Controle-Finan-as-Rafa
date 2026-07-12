import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  FindingStatus,
  NoteClassification,
  NoteStatus,
  ValidationDecision,
} from "@/generated/prisma/enums";
import { REVIEW_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const validationSchema = z
  .object({
    comment: z.string().trim().max(500).optional().default(""),
    decision: z.enum(["OK", "SUSPEITA"]),
    noteId: z.string().uuid(),
    reason: z.string().trim().max(180).optional().default(""),
  })
  .superRefine((data, context) => {
    if (data.decision === "SUSPEITA" && !data.reason) {
      context.addIssue({
        code: "custom",
        message: "Informe o motivo que confirma a suspeita.",
        path: ["reason"],
      });
    }
  });

export async function POST(request: NextRequest) {
  const auth = await requireApiRoles(REVIEW_ROLES);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { erro: { codigo: "JSON_INVALIDO", mensagem: "Dados inválidos." } },
      { status: 400 },
    );
  }

  const parsed = validationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        erro: {
          codigo: "VALIDACAO_INVALIDA",
          mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        },
      },
      { status: 422 },
    );
  }

  const { comment, decision, noteId, reason } = parsed.data;
  const reviewerConfirmed = decision === "SUSPEITA";

  try {
    const validation = await prisma.$transaction(async (tx) => {
      const note = await tx.note.findFirst({
        where: {
          classification: NoteClassification.SUSPICIOUS,
          id: noteId,
          status: NoteStatus.PENDING_VALIDATION,
        },
        select: {
          findings: {
            orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
            select: { id: true },
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

      const created = await tx.validation.create({
        data: {
          comment: comment || null,
          decision: reviewerConfirmed
            ? ValidationDecision.SUSPICION_CONFIRMED
            : ValidationDecision.FALSE_POSITIVE,
          findingId: note.findings[0]?.id ?? null,
          noteId,
          reason: reason || "Sem motivo informado",
          validatorId: auth.profile.id,
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
          noteId,
          status: FindingStatus.OPEN,
        },
      });

      await tx.note.update({
        data: {
          status: reviewerConfirmed ? NoteStatus.REJECTED : NoteStatus.APPROVED,
        },
        where: { id: noteId },
      });

      await tx.noteEvent.create({
        data: {
          actorId: auth.profile.id,
          data: {
            comment: comment || null,
            decision,
            reason: reason || null,
            validationId: created.id,
          },
          fromStatus: NoteStatus.PENDING_VALIDATION,
          noteId,
          toStatus: reviewerConfirmed ? NoteStatus.REJECTED : NoteStatus.APPROVED,
          type: "VALIDATION_RECORDED",
        },
      });

      return created;
    });

    if (!validation) {
      return NextResponse.json(
        {
          erro: {
            codigo: "NOTA_INDISPONIVEL",
            mensagem: "A nota não está mais aguardando validação.",
          },
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ validation }, { status: 201 });
  } catch (error) {
    console.error("validation.create.failed", error);
    return NextResponse.json(
      {
        erro: {
          codigo: "ERRO_INTERNO",
          mensagem: "Não foi possível registrar a validação.",
        },
      },
      { status: 500 },
    );
  }
}

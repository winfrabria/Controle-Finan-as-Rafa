import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { UserRole } from "@/generated/prisma/enums";
import { REVIEW_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { recordReviewerValidation } from "@/server/notes/record-reviewer-validation";

export const runtime = "nodejs";

const validationSchema = z
  .object({
    comment: z.string().trim().max(500).optional().default(""),
    decision: z.enum(["OK", "SUSPEITA"]),
    noteId: z.string().uuid(),
    noteVersion: z.number().int().positive(),
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
  if (auth.profile.role !== UserRole.REVIEWER) {
    return NextResponse.json(
      {
        erro: {
          codigo: "ACESSO_NEGADO",
          mensagem: "A decisão deve ser registrada pelo revisor responsável.",
        },
      },
      { status: 403 },
    );
  }

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

  try {
    const validation = await recordReviewerValidation({
      ...parsed.data,
      reviewerId: auth.profile.id,
    });
    if (!validation) {
      return NextResponse.json(
        {
          erro: {
            codigo: "VERSAO_DA_NOTA_CONFLITANTE",
            mensagem: "A nota foi alterada por outra operação. Atualize a fila.",
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

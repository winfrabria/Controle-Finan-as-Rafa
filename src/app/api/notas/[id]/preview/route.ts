import { NextResponse } from "next/server";

import { prisma } from "@/server/db/prisma";
import { statusFor } from "@/server/notes/public-status";
import { hashPublicCapability, matchesPublicCapability, readPublicCapabilityCookie } from "@/server/notes/public-capability";
import { createInvoiceSignedUrl } from "@/server/storage";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PREVIEW_SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_INVALIDA", mensagem: "Anexo inválido." } },
      { status: 400, headers: PREVIEW_SECURITY_HEADERS },
    );
  }
  const token = readPublicCapabilityCookie(request, id);
  if (!token) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Anexo não encontrado." } },
      { status: 404, headers: PREVIEW_SECURITY_HEADERS },
    );
  }

  const note = await prisma.note.findFirst({
    where: { id, publicTokenHash: hashPublicCapability(token) },
    select: {
      originalFileName: true,
      originalFilePath: true,
      originalMimeType: true,
      auditResult: true,
      contextQuestions: {
        select: { round: true },
        where: { round: { gt: 0 } },
      },
      contextRound: true,
      contextSubmissions: {
        orderBy: { submittedAt: "desc" },
        select: { round: true, status: true },
      },
      processingStage: true,
      publicTokenHash: true,
      publicTokenExpiresAt: true,
      status: true,
    },
  });
  if (!note || !matchesPublicCapability(token, note.publicTokenHash, note.publicTokenExpiresAt)) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Anexo não encontrado." } },
      { status: 404, headers: PREVIEW_SECURITY_HEADERS },
    );
  }

  const submissionStatus = note.contextSubmissions.find(
    (submission) => submission.round === note.contextRound,
  )?.status;
  const previewStatus = statusFor({
    auditResult: note.auditResult,
    hasActiveQuestions: note.contextQuestions.some(
      (question) => question.round === note.contextRound,
    ),
    processingStage: note.processingStage,
    status: note.status,
    submissionStatus,
  });
  if (
    previewStatus === "COMPLETED" ||
    previewStatus === "READ_FAILED" ||
    previewStatus === "FAILED"
  ) {
    return NextResponse.json(
      { erro: { codigo: "NOTA_NAO_ENCONTRADA", mensagem: "Anexo não encontrado." } },
      { status: 404, headers: PREVIEW_SECURITY_HEADERS },
    );
  }

  try {
    const signed = await createInvoiceSignedUrl({
      expiresInSeconds: 5 * 60,
      path: note.originalFilePath,
    });
    return NextResponse.json(
      {
        preview: {
          expiresInSeconds: signed.expiresInSeconds,
          fileName: note.originalFileName,
          mimeType: note.originalMimeType,
          url: signed.signedUrl,
        },
      },
      { headers: PREVIEW_SECURITY_HEADERS },
    );
  } catch (error) {
    console.error("public.note.preview.failed", {
      message: error instanceof Error ? error.message : "unknown error",
      noteId: id,
    });
    return NextResponse.json(
      { erro: { codigo: "PREVIEW_INDISPONIVEL", mensagem: "A visualização não está disponível." } },
      { status: 502, headers: PREVIEW_SECURITY_HEADERS },
    );
  }
}

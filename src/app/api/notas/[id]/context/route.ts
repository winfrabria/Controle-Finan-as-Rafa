import { randomUUID } from "node:crypto";

import { after, NextResponse } from "next/server";

import {
  contextAnswersRequestSchema,
  ContextQuestionError,
  submitContextAnswers,
} from "@/server/notes/context-questions";
import {
  getPublicCapabilityCookieName,
  isTrustedPublicOrigin,
  publicCapabilityCookieOptions,
  PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
  readPublicCapabilityCookie,
} from "@/server/notes/public-capability";
import { processProcessingJob } from "@/server/notes/processing-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { erro: { codigo: code, mensagem: message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return errorResponse("NOTA_INVALIDA", "Anexo inválido.", 400);
  }
  if (!isTrustedPublicOrigin(request)) {
    return errorResponse("ORIGEM_INVALIDA", "A origem da solicitação não é aceita.", 403);
  }

  const token = readPublicCapabilityCookie(request, id);
  if (!token) {
    return errorResponse("NOTA_NAO_ENCONTRADA", "Anexo não encontrado.", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("CONTEXTO_INVALIDO", "Informe as respostas em JSON.", 400);
  }
  const parsed = contextAnswersRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "CONTEXTO_INVALIDO",
      parsed.error.issues[0]?.message ?? "Respostas inválidas.",
      422,
    );
  }

  try {
    const result = await submitContextAnswers({
      answers: parsed.data.respostas,
      noteId: id,
      requestId: request.headers.get("x-request-id") ?? randomUUID(),
      token,
    });
    after(async () => {
      if (!result.jobId || result.status !== "REANALYSIS_QUEUED") return;
      try {
        await processProcessingJob(result.jobId, {
          workerId: `context:${randomUUID()}`,
        });
      } catch (error) {
        console.error("Background context reanalysis failed", {
          jobId: result.jobId,
          message: error instanceof Error ? error.message : "unknown error",
          noteId: id,
        });
      }
    });

    const response = NextResponse.json(
      {
        nota: { id: result.noteId, protocolo: result.protocol },
        contexto: {
          rodada: result.round,
          // Keep internal queue/retry states out of the public contract.
          status: "PROCESSING",
        },
      },
      { status: result.alreadySubmitted ? 200 : 202, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      getPublicCapabilityCookieName(id),
      token,
      publicCapabilityCookieOptions(id, PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS),
    );
    return response;
  } catch (error) {
    if (error instanceof ContextQuestionError) {
      const status =
        error.code === "CONTEXT_TOKEN_INVALID"
          ? 404
          : error.code === "CONTEXT_ALREADY_SUBMITTED" ||
              error.code === "CONTEXT_CONFLICT" ||
              error.code === "CONTEXT_NOT_REQUIRED"
            ? 409
            : 422;
      return errorResponse(error.code, error.message, status);
    }
    console.error("public.context.submit.failed", {
      message: error instanceof Error ? error.message : "unknown error",
      noteId: id,
    });
    return errorResponse("ERRO_INTERNO", "Não foi possível registrar as respostas.", 500);
  }
}

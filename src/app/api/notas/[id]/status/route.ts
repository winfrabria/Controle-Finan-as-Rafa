import { after, NextResponse } from "next/server";

import {
  ContextSubmissionStatus,
  NoteStatus,
  ProcessingJobStatus,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { toPublicContextQuestion } from "@/server/notes/context-questions";
import { processProcessingJob } from "@/server/notes/processing-jobs";
import { statusFor } from "@/server/notes/public-status";
import {
  getPublicCapabilityCookieName,
  publicCapabilityCookieOptions,
  readPublicCapabilityCookie,
  PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
  revokedPublicCapabilityFields,
  terminalPublicCapabilityFields,
} from "@/server/notes/public-capability";
import { hashPublicCapability, matchesPublicCapability } from "@/server/notes/public-capability";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicError(code: string, message: string, status: number) {
  return NextResponse.json(
    { erro: { codigo: code, mensagem: message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return publicError("NOTA_INVALIDA", "Anexo inválido.", 400);
  }

  const token = readPublicCapabilityCookie(request, id);
  if (!token) {
    return publicError("NOTA_NAO_ENCONTRADA", "Anexo não encontrado.", 404);
  }
  const tokenHash = hashPublicCapability(token);
  const note = await prisma.note.findFirst({
    where: { id, publicTokenHash: tokenHash },
    select: {
      auditResult: true,
      contextQuestions: {
        orderBy: { position: "asc" },
        select: {
          code: true,
          createdAt: true,
          id: true,
          options: true,
          position: true,
          prompt: true,
          required: true,
          round: true,
          type: true,
        },
        where: { round: { gt: 0 } },
      },
      contextRound: true,
      contextSubmittedAt: true,
      contextSubmissions: {
        orderBy: { submittedAt: "desc" },
        select: { round: true, status: true },
      },
      id: true,
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          attempt: true,
          availableAt: true,
          id: true,
          maxAttempts: true,
          status: true,
        },
      },
      processingStage: true,
      publicProtocol: true,
      publicTokenHash: true,
      publicTokenExpiresAt: true,
      status: true,
      version: true,
    },
  });

  if (!note || !matchesPublicCapability(token, note.publicTokenHash, note.publicTokenExpiresAt)) {
    return publicError("NOTA_NAO_ENCONTRADA", "Anexo não encontrado.", 404);
  }

  // Keep the status endpoint compatible with older records/mocks that do not
  // have a processing-job relation yet.
  const latestJob = note.processingJobs?.[0];
  const now = new Date();
  const jobIsDue =
    latestJob &&
    latestJob.attempt < latestJob.maxAttempts &&
    latestJob.availableAt <= now &&
    (latestJob.status === ProcessingJobStatus.PENDING ||
      latestJob.status === ProcessingJobStatus.FAILED);

  // The upload request starts the first attempt with `after()`. If it fails,
  // the public polling request becomes the recovery signal, so a Vercel cron
  // is not required for the next attempt to begin.
  if (jobIsDue) {
    after(async () => {
      try {
        await processProcessingJob(latestJob.id, {
          workerId: `public-status:${id}`,
        });
      } catch (error) {
        console.error("Public status processing recovery failed", {
          jobId: latestJob.id,
          message: error instanceof Error ? error.message : "unknown error",
          noteId: id,
        });
      }
    });
  }

  const jobExhausted =
    latestJob?.status === ProcessingJobStatus.FAILED &&
    latestJob.attempt >= latestJob.maxAttempts;
  if (
    jobExhausted &&
    note.status !== NoteStatus.FAILED &&
    note.status !== NoteStatus.READ_FAILED
  ) {
    const finalized = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.note.updateMany({
        where: {
          id: note.id,
          version: note.version,
          status: { in: [NoteStatus.RECEIVED, NoteStatus.PROCESSING] },
        },
        data: {
          failureCode: "PROCESSING_ATTEMPTS_EXHAUSTED",
          failureMessage:
            "O anexo não pôde ser processado após as tentativas automáticas.",
          ...terminalPublicCapabilityFields(),
          processingStage: ProcessingStage.FAILED,
          status: NoteStatus.FAILED,
          version: { increment: 1 },
        },
      });
      if (updated.count === 1) {
        await transaction.noteEvent.create({
          data: {
            noteId: note.id,
            type: "PROCESSING_ATTEMPTS_EXHAUSTED",
            fromStatus: note.status,
            toStatus: NoteStatus.FAILED,
            data: { jobId: latestJob.id },
          },
        });
      }
      return updated.count === 1;
    });
    if (finalized) {
      note.status = NoteStatus.FAILED;
      note.processingStage = ProcessingStage.FAILED;
    }
  }

  const submissionStatus = note.contextSubmissions.find(
    (submission) => submission.round === note.contextRound,
  )?.status;
  const contextQuestions = note.contextQuestions.filter(
    (question) => question.round === note.contextRound,
  );
  const publicStatus = jobExhausted
    ? ("FAILED" as const)
    : statusFor({
    auditResult: note.auditResult,
    hasActiveQuestions: contextQuestions.length > 0,
    processingStage: note.processingStage,
    status: note.status,
    submissionStatus,
  });
  const isTerminalPublicStatus =
    publicStatus === "COMPLETED" ||
    publicStatus === "READ_FAILED" ||
    publicStatus === "FAILED";
  if (isTerminalPublicStatus) {
    const consumed = await prisma.note.updateMany({
      where: {
        id: note.id,
        publicTokenHash: note.publicTokenHash,
        publicTokenExpiresAt: { gt: new Date() },
        version: note.version,
      },
      data: {
        ...revokedPublicCapabilityFields(),
        version: { increment: 1 },
      },
    });
    if (consumed.count !== 1) {
      return publicError("NOTA_NAO_ENCONTRADA", "Anexo não encontrado.", 404);
    }
  }
  const responseBody: {
    nota: Record<string, unknown>;
  } = {
    nota: {
      etapa:
        note.processingStage === "RECEIVED" || note.processingStage === "EXTRACTING"
          ? "READING"
          : "CHECKING",
      estadoPublico: publicStatus,
      id: note.id,
      protocolo: note.publicProtocol,
    },
  };

  if (publicStatus === "NEEDS_CONTEXT") {
    const canAnswer = !submissionStatus && contextQuestions.length > 0;
    if (canAnswer) {
      responseBody.nota.perguntas = contextQuestions.map((question) =>
        toPublicContextQuestion(question),
      );
    }
  }
  if (publicStatus === "READ_FAILED") {
    responseBody.nota.erro = {
      codigo: "READ_FAILED",
      mensagem: "Não foi possível ler o anexo com qualidade suficiente.",
    };
  }
  if (publicStatus === "FAILED") {
    responseBody.nota.erro = {
      codigo: "FAILED",
      mensagem: "O processamento precisa ser tentado novamente.",
    };
  }

  let contextCookieMaxAge: number | null = null;
  if (publicStatus === "NEEDS_CONTEXT" && !submissionStatus) {
    const activeQuestion = contextQuestions[0];
    const anchoredExpiry = activeQuestion
      ? new Date(activeQuestion.createdAt.getTime() + PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS * 1_000)
      : note.publicTokenExpiresAt;
    if (anchoredExpiry.getTime() !== note.publicTokenExpiresAt.getTime()) {
      await prisma.note.updateMany({
        where: {
          contextRound: note.contextRound,
          contextSubmittedAt: null,
          id,
          publicTokenHash: note.publicTokenHash,
        },
        data: { publicTokenExpiresAt: anchoredExpiry },
      });
    }
    contextCookieMaxAge = Math.max(
      1,
      Math.min(
        PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
        Math.ceil((anchoredExpiry.getTime() - Date.now()) / 1_000),
      ),
    );
  } else if (
    publicStatus === "PROCESSING" &&
    submissionStatus === ContextSubmissionStatus.REANALYSIS_QUEUED
  ) {
    contextCookieMaxAge = Math.max(
      1,
      Math.min(
        PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
        Math.ceil((note.publicTokenExpiresAt.getTime() - Date.now()) / 1_000),
      ),
    );
  }

  const response = NextResponse.json(responseBody, {
    headers: { "Cache-Control": "no-store" },
  });
  if (contextCookieMaxAge !== null) {
    response.cookies.set(
      getPublicCapabilityCookieName(id),
      token,
      publicCapabilityCookieOptions(id, contextCookieMaxAge),
    );
  }
  if (isTerminalPublicStatus) {
    response.cookies.set(
      getPublicCapabilityCookieName(id),
      "",
      publicCapabilityCookieOptions(id, 0),
    );
  }
  return response;
}

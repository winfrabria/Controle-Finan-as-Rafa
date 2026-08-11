import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  AuditResult,
  ContextQuestionType,
  ContextSubmissionStatus,
  NoteStatus,
  ProcessingJobType,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";
import { hashPublicCapability, matchesPublicCapability } from "@/server/notes/public-capability";

export const CONTEXT_MAX_QUESTIONS = 3;
export const CONTEXT_MAX_ANSWER_LENGTH = 500;

export const contextAnswersRequestSchema = z
  .object({
    respostas: z
      .array(
        z
          .object({
            perguntaId: z.string().uuid(),
            valor: z.union([
              z.string().trim().max(CONTEXT_MAX_ANSWER_LENGTH),
              z.number().finite(),
              z.boolean(),
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(CONTEXT_MAX_QUESTIONS),
  })
  .strict();

export type ContextAnswersRequest = z.infer<typeof contextAnswersRequestSchema>;

export class ContextQuestionError extends Error {
  constructor(
    public readonly code:
      | "CONTEXT_ALREADY_SUBMITTED"
      | "CONTEXT_CONFLICT"
      | "CONTEXT_NOT_REQUIRED"
      | "CONTEXT_QUESTION_INVALID"
      | "CONTEXT_TOKEN_INVALID"
      | "CONTEXT_UNAVAILABLE"
      | "NOTE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ContextQuestionError";
  }
}

type StoredQuestion = {
  code: string;
  id: string;
  options: unknown;
  position: number;
  prompt: string;
  required: boolean;
  type: ContextQuestionType;
};

type NormalizedAnswer = {
  questionId: string;
  value: string | number | boolean;
};

function optionLabels(options: unknown) {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const label = (option as { label?: unknown }).label;
    return typeof label === "string" && label.trim() ? [label.trim()] : [];
  });
}

/**
 * Some early provider responses produced opaque placeholder labels (for
 * example "All Violet"/"All Filet") instead of a question-specific choice.
 * They are not useful to the sender and should never be rendered as a
 * select.  Keeping this normalization at the public boundary also makes old
 * rows safe without requiring a destructive data migration.
 */
function isOpaqueOptionLabel(label: string) {
  return /^(?:all\s+(?:violet|filet)|option\s*\d+|choice\s*[a-z]|value\s*\d+)$/i.test(
    label.trim(),
  );
}

function usableOptionLabels(options: unknown) {
  return optionLabels(options).filter((label) => !isOpaqueOptionLabel(label));
}

function hasUsableSelectOptions(options: unknown) {
  return usableOptionLabels(options).length >= 2;
}

function normalizedSelectValue(options: unknown, answer: string) {
  if (!hasUsableSelectOptions(options)) {
    const normalized = answer.trim();
    return normalized.length > 0 && normalized.length <= CONTEXT_MAX_ANSWER_LENGTH
      ? normalized
      : null;
  }
  if (!Array.isArray(options)) return null;
  const selected = options.find((option) => {
    if (!option || typeof option !== "object") return false;
    const candidate = option as { label?: unknown; value?: unknown };
    return candidate.value === answer || candidate.label === answer;
  });
  if (!selected || typeof selected !== "object") return null;
  const label = (selected as { label?: unknown }).label;
  const value = (selected as { value?: unknown }).value;
  return typeof label === "string" && label.trim()
    ? label.trim()
    : typeof value === "string"
      ? value
      : null;
}

function normalizeAnswer(question: StoredQuestion, value: unknown) {
  if (question.type === ContextQuestionType.TEXT) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= CONTEXT_MAX_ANSWER_LENGTH
      ? normalized
      : null;
  }

  if (question.type === ContextQuestionType.NUMBER) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value.replace(",", "."))
          : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (question.type === ContextQuestionType.BOOLEAN) {
    return typeof value === "boolean" ? value : null;
  }

  if (typeof value !== "string") return null;
  return normalizedSelectValue(question.options, value);
}

export function validateContextAnswers(
  questions: StoredQuestion[],
  answers: ContextAnswersRequest["respostas"],
) {
  if (questions.length === 0 || questions.length > CONTEXT_MAX_QUESTIONS) {
    throw new ContextQuestionError(
      "CONTEXT_UNAVAILABLE",
      "Não há perguntas de contexto disponíveis.",
    );
  }

  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const answerIds = new Set<string>();
  const normalized: NormalizedAnswer[] = [];

  for (const answer of answers.map((item) => ({ questionId: item.perguntaId, value: item.valor }))) {
    if (answerIds.has(answer.questionId)) {
      throw new ContextQuestionError(
        "CONTEXT_QUESTION_INVALID",
        "Uma pergunta não pode ser respondida duas vezes.",
      );
    }
    answerIds.add(answer.questionId);
    const question = questionMap.get(answer.questionId);
    if (!question) {
      throw new ContextQuestionError(
        "CONTEXT_QUESTION_INVALID",
        "A pergunta informada não pertence a este protocolo.",
      );
    }
    const value = normalizeAnswer(question, answer.value);
    if (value === null) {
      throw new ContextQuestionError(
        "CONTEXT_QUESTION_INVALID",
        `A resposta para ${question.code} não tem o formato aceito.`,
      );
    }
    normalized.push({ questionId: question.id, value });
  }

  const missingRequired = questions.some(
    (question) => question.required && !answerIds.has(question.id),
  );
  if (missingRequired) {
    throw new ContextQuestionError(
      "CONTEXT_QUESTION_INVALID",
      "Responda todas as perguntas obrigatórias.",
    );
  }

  return normalized.sort((left, right) => left.questionId.localeCompare(right.questionId));
}

function fingerprintAnswers(answers: NormalizedAnswer[]) {
  return createHash("sha256")
    .update(JSON.stringify(answers))
    .digest("hex");
}

export function toPublicContextQuestion(question: StoredQuestion) {
  const selectOptions = usableOptionLabels(question.options);
  const isSelect =
    question.type === ContextQuestionType.SINGLE_SELECT && selectOptions.length >= 2;

  return {
    id: question.id,
    obrigatoria: question.required,
    opcoes: isSelect ? selectOptions : undefined,
    pergunta: question.prompt,
    tipo:
      question.type === ContextQuestionType.BOOLEAN
        ? "CONFIRMATION"
        : isSelect
          ? "SELECT"
          : "TEXT",
  };
}

export async function submitContextAnswers(input: {
  answers: ContextAnswersRequest["respostas"];
  noteId: string;
  requestId?: string;
  token: string;
}) {
  const tokenHash = hashPublicCapability(input.token);
  const readAt = new Date();
  const current = await prisma.note.findFirst({
    where: {
      id: input.noteId,
      publicTokenHash: tokenHash,
      publicTokenExpiresAt: { gt: readAt },
    },
    select: {
      auditResult: true,
      contextRound: true,
      id: true,
      publicProtocol: true,
      status: true,
      version: true,
    },
  });

  if (!current) {
    throw new ContextQuestionError(
      "CONTEXT_TOKEN_INVALID",
      "O protocolo ou a capacidade de acompanhamento são inválidos.",
    );
  }
  const [questions, existing] = await Promise.all([
    prisma.noteContextQuestion.findMany({
      where: { noteId: current.id, round: current.contextRound },
      orderBy: { position: "asc" },
      select: {
        code: true,
        id: true,
        options: true,
        position: true,
        prompt: true,
        required: true,
        type: true,
      },
    }),
    prisma.noteContextSubmission.findUnique({
      where: {
        noteId_round: { noteId: current.id, round: current.contextRound },
      },
      select: {
        answerFingerprint: true,
        id: true,
        processingJob: { select: { id: true } },
        round: true,
        status: true,
      },
    }),
  ]);
  if (!existing && current.auditResult !== AuditResult.NEEDS_CONTEXT) {
    throw new ContextQuestionError(
      "CONTEXT_NOT_REQUIRED",
      "Este anexo não aguarda informação de contexto.",
    );
  }
  const normalized = validateContextAnswers(questions, input.answers);
  const answerFingerprint = fingerprintAnswers(normalized);
  if (existing) {
    if (existing.answerFingerprint === answerFingerprint) {
      return {
        alreadySubmitted: true,
        capability: null,
        jobId: existing.processingJob?.id ?? null,
        noteId: current.id,
        protocol: current.publicProtocol,
        round: existing.round,
        status: existing.status,
      } as const;
    }
    throw new ContextQuestionError(
      "CONTEXT_ALREADY_SUBMITTED",
      "A rodada de contexto deste anexo já foi enviada.",
    );
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      const now = new Date();
      const extendedExpiry = new Date(now.getTime() + 30 * 60 * 1_000);
      const claimed = await transaction.note.updateMany({
        where: {
          auditResult: AuditResult.NEEDS_CONTEXT,
          contextRound: current.contextRound,
          id: current.id,
          publicTokenExpiresAt: { gt: now },
          publicTokenHash: tokenHash,
          version: current.version,
        },
        data: {
          contextSubmittedAt: now,
          failureCode: null,
          failureMessage: null,
          publicTokenExpiresAt: extendedExpiry,
          processingStage: ProcessingStage.ANALYZING,
          status: NoteStatus.PROCESSING,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        throw new ContextQuestionError(
          "CONTEXT_CONFLICT",
          "O anexo mudou enquanto as respostas eram enviadas. Consulte o status novamente.",
        );
      }
      const submission = await transaction.noteContextSubmission.create({
        data: {
          answerFingerprint,
          idempotencyKey: `context:${current.id}:${current.contextRound}`,
          noteId: current.id,
          requestId: input.requestId,
          round: current.contextRound,
          status: ContextSubmissionStatus.SUBMITTED,
          answers: {
            create: normalized.map((answer) => ({
              questionId: answer.questionId,
              value: answer.value as Prisma.InputJsonValue,
            })),
          },
        },
        select: { id: true, round: true, status: true },
      });
      const job = await transaction.processingJob.create({
        data: {
          availableAt: new Date(),
          contextSubmissionId: submission.id,
          idempotencyKey: `context-reanalysis:${current.id}:${current.contextRound}`,
          maxAttempts: 2,
          noteId: current.id,
          type: ProcessingJobType.CONTEXT_REANALYSIS,
        },
        select: { id: true },
      });
      await transaction.noteContextSubmission.update({
        where: { id: submission.id },
        data: { reanalysisQueuedAt: now, status: ContextSubmissionStatus.REANALYSIS_QUEUED },
      });
      await transaction.noteEvent.create({
        data: {
          noteId: current.id,
          type: "CONTEXT_SUBMITTED",
          fromStatus: current.status,
          toStatus: NoteStatus.PROCESSING,
          data: {
            questionCount: normalized.length,
            reanalysisJobId: job.id,
            round: current.contextRound,
          },
        },
      });
      return {
        alreadySubmitted: false,
        capability: null,
        jobId: job.id,
        noteId: current.id,
        protocol: current.publicProtocol,
        round: submission.round,
        status: ContextSubmissionStatus.REANALYSIS_QUEUED,
      } as const;
    });
  } catch (error) {
    const isUniqueRace =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const isCompareAndSetConflict =
      error instanceof ContextQuestionError && error.code === "CONTEXT_CONFLICT";
    if (isUniqueRace || isCompareAndSetConflict) {
      const latest = await prisma.note.findUnique({
        where: { id: current.id },
        select: {
          auditResult: true,
          contextRound: true,
          publicTokenHash: true,
          publicTokenExpiresAt: true,
        },
      });
      if (
        !latest ||
        latest.auditResult !== AuditResult.NEEDS_CONTEXT ||
        latest.contextRound !== current.contextRound ||
        latest.publicTokenHash !== tokenHash
      ) {
        throw new ContextQuestionError(
          "CONTEXT_CONFLICT",
          "O anexo mudou enquanto as respostas eram enviadas. Consulte o status novamente.",
        );
      }
      const existing = await prisma.noteContextSubmission.findUnique({
        where: { idempotencyKey: `context:${current.id}:${current.contextRound}` },
        select: {
          answerFingerprint: true,
          id: true,
          processingJob: { select: { id: true } },
          round: true,
          status: true,
        },
      });
      if (existing && existing.answerFingerprint === answerFingerprint) {
        return {
          alreadySubmitted: true,
          capability: null,
          jobId: existing.processingJob?.id ?? null,
          noteId: current.id,
          protocol: current.publicProtocol,
          round: existing.round,
          status: existing.status,
        } as const;
      }
      throw new ContextQuestionError(
        isCompareAndSetConflict ? "CONTEXT_CONFLICT" : "CONTEXT_ALREADY_SUBMITTED",
        isCompareAndSetConflict
          ? "O anexo mudou enquanto as respostas eram enviadas. Consulte o status novamente."
          : "A rodada de contexto deste anexo já foi enviada.",
      );
    }
    if (error instanceof ContextQuestionError) throw error;
    throw error;
  }
}

export function isContextCapabilityValid(
  token: string | null,
  storedHash: string,
  expiresAt: Date,
) {
  return matchesPublicCapability(token, storedHash, expiresAt);
}

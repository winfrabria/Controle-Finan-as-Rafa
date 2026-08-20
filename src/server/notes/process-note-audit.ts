import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  AiRunKind,
  AiRunStatus,
  AuditResult,
  ContextSubmissionStatus,
  FindingSource,
  FindingStatus,
  NoteClassification,
  NoteStatus,
  NotificationType,
  ProcessingStage,
  ReasoningEffort,
  UserRole,
} from "@/generated/prisma/enums";
import {
  HARNESS_VERSIONS,
  evaluateHarness,
  evaluateUniversalRules,
  evaluateWorkRules,
  isReadFailure,
  isSupportedFinding,
  resolveAuditEvaluatorModel,
  resolveAuditReasoningEffort,
  resolvePostContextClassification,
  sanitizeForPersistence,
  selectReasoningEffort,
  type ContextAnswerForAudit,
  type HarnessClassification,
  type HarnessInvoice,
  type WorkRuleInput,
} from "@/lib/audit-harness";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import {
  getOpenRouterAuditDiscoveryClient,
  OpenRouterAuditDiscoveryError,
  type AuditDiscoveryClient,
} from "@/server/integrations/openrouter/audit-client";
import { OpenRouterClientError } from "@/server/integrations/openrouter/client";
import {
  PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
  terminalPublicCapabilityFields,
} from "@/server/notes/public-capability";
import { invalidateNoteReads } from "@/server/notes/note-read-invalidation";
import {
  createNotificationWithPushDeliveries,
  dispatchPendingPushDeliveries,
} from "@/server/push/delivery-service";

export class AuditPipelineError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuditPipelineError";
  }
}

function getAuditFailureDetails(error: unknown) {
  const attemptDetails =
    error instanceof OpenRouterAuditDiscoveryError
      ? {
          attempts: error.attempts,
          attemptTrace: error.attemptTrace,
          model: error.model,
        }
      : { attemptTrace: [] };

  if (error instanceof AuditPipelineError) {
    return {
      ...attemptDetails,
      code: error.code,
      message: error.message,
      noteMessage: error.message,
    };
  }

  if (error instanceof OpenRouterClientError) {
    if (error.status === 402) {
      return {
        ...attemptDetails,
        code: "AUDIT_CREDIT_EXHAUSTED",
        message: "Os créditos do provedor de IA são insuficientes para concluir a auditoria.",
        noteMessage: "A auditoria não pôde continuar porque o provedor de IA está sem crédito disponível.",
      };
    }

    if (error.kind === "timeout") {
      return {
        ...attemptDetails,
        code: "AUDIT_TIMEOUT",
        message: "A auditoria excedeu o tempo limite dos modelos disponíveis.",
        noteMessage: "A auditoria excedeu o tempo limite e será repetida automaticamente.",
      };
    }

    if (error.kind === "invalid-response") {
      return {
        ...attemptDetails,
        code: "AUDIT_INVALID_RESPONSE",
        message: "A resposta da auditoria não pôde ser validada.",
        noteMessage: "A auditoria retornou uma resposta inválida e será repetida automaticamente.",
      };
    }
  }

  return {
    ...attemptDetails,
    code: "AUDIT_PROVIDER_ERROR",
    message: "Os provedores de IA disponíveis não concluíram a auditoria.",
    noteMessage: "A auditoria está temporariamente indisponível e será repetida automaticamente.",
  };
}

function toJson(value: unknown) {
  return sanitizeForPersistence(value) as Prisma.InputJsonValue;
}

function nullableJson(value: unknown) {
  return value === null ? Prisma.JsonNull : toJson(value);
}

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function classificationValue(value: HarnessClassification) {
  if (value === "OK") return NoteClassification.OK;
  if (value === "SUSPICIOUS") return NoteClassification.SUSPICIOUS;
  return null;
}

function auditResultValue(value: HarnessClassification) {
  return {
    OK: AuditResult.OK,
    SUSPICIOUS: AuditResult.SUSPICIOUS,
    NEEDS_CONTEXT: AuditResult.NEEDS_CONTEXT,
    READ_FAILED: AuditResult.READ_FAILED,
  }[value];
}

function noteStatus(value: HarnessClassification) {
  if (value === "READ_FAILED") return NoteStatus.READ_FAILED;
  if (value === "SUSPICIOUS") return NoteStatus.PENDING_VALIDATION;
  if (value === "NEEDS_CONTEXT") return NoteStatus.PROCESSING;
  return NoteStatus.OK;
}

type ContextSubmissionForAudit = {
  answers: Array<{
    question: { code: string; prompt: string; type: string };
    value: Prisma.JsonValue;
  }>;
  id: string;
};

async function loadAuditContext(noteId: string, contextSubmissionId?: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      contextRound: true,
      documentNumber: true,
      extractedData: true,
      id: true,
      issuedAt: true,
      processingStage: true,
      supplierTaxId: true,
      totalAmount: true,
      version: true,
      workId: true,
    },
  });
  if (!note) throw new AuditPipelineError("NOTE_NOT_FOUND", "Nota não encontrada.");
  if (note.processingStage !== ProcessingStage.ANALYZING || !note.extractedData) {
    throw new AuditPipelineError("AUDIT_NOT_ALLOWED", "A nota não está pronta para auditoria.");
  }
  const activeContextQuestion = await prisma.noteContextQuestion.findFirst({
    where: { noteId, round: note.contextRound },
    select: { id: true },
  });

  const parsed = invoiceExtractionSchema.safeParse(note.extractedData);
  if (!parsed.success) {
    throw new AuditPipelineError("AUDIT_INVALID_EXTRACTION", "Os dados extraídos não são válidos.", { cause: parsed.error });
  }
  const invoice: HarnessInvoice = parsed.data;
  const workRulesEnabled = process.env.HARNESS_WORK_RULES_ENABLED === "true";
  const activeRules = await prisma.auditRule.findMany({
    where: workRulesEnabled
      ? { active: true, OR: [{ workId: null }, { workId: note.workId }] }
      : { active: true, workId: null },
    orderBy: [{ priority: "asc" }, { code: "asc" }],
    select: { category: true, code: true, configuration: true, name: true, severity: true },
  });
  const workRules: WorkRuleInput[] = activeRules.map((rule) => ({ ...rule, severity: rule.severity }));
  const duplicates = await prisma.note.findMany({
    where: {
      id: { not: note.id },
      supplierTaxId: note.supplierTaxId,
      documentNumber: note.documentNumber,
      totalAmount: note.totalAmount,
      issuedAt: note.issuedAt,
      status: { notIn: [NoteStatus.FAILED, NoteStatus.READ_FAILED] },
    },
    select: { documentNumber: true, id: true, issuedAt: true, supplierTaxId: true, totalAmount: true },
    take: 20,
  });

  let contextSubmission: ContextSubmissionForAudit | null = null;
  if (contextSubmissionId) {
    contextSubmission = await prisma.noteContextSubmission.findUnique({
      where: { id: contextSubmissionId },
      select: {
        answers: {
          orderBy: { question: { position: "asc" } },
          select: {
            question: { select: { code: true, prompt: true, type: true } },
            value: true,
          },
        },
        id: true,
      },
    });
    if (!contextSubmission) {
      throw new AuditPipelineError("CONTEXT_SUBMISSION_NOT_FOUND", "A rodada de contexto não foi encontrada.");
    }
  }

  const contextAnswers: ContextAnswerForAudit[] | undefined = contextSubmission
    ? contextSubmission.answers.flatMap((answer) => {
        const value = answer.value;
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
        return [{ code: answer.question.code, question: answer.question.prompt, type: answer.question.type as ContextAnswerForAudit["type"], value }];
      })
    : undefined;

  return {
    contextAnswers,
    contextQuestionCount: activeContextQuestion ? 1 : 0,
    contextRound: note.contextRound,
    contextSubmissionId: contextSubmission?.id ?? null,
    duplicates: duplicates.map((duplicate) => ({
      noteId: duplicate.id,
      documentNumber: duplicate.documentNumber,
      supplierTaxId: duplicate.supplierTaxId,
      issuedAt: dateOnly(duplicate.issuedAt),
      totalAmount: duplicate.totalAmount?.toString() ?? null,
    })),
    invoice,
    noteVersion: note.version,
    workRules,
  };
}

async function finalizeReadFailure(
  noteId: string,
  expectedVersion: number,
  contextSubmissionId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const finalized = await tx.note.updateMany({
      where: {
        id: noteId,
        processingStage: ProcessingStage.ANALYZING,
        status: NoteStatus.PROCESSING,
        version: expectedVersion,
      },
      data: {
        auditResult: AuditResult.READ_FAILED,
        classification: null,
        failureCode: "READ_FAILED",
        failureMessage: "A leitura não possui qualidade mínima para auditoria.",
        processedAt: new Date(),
        processingStage: ProcessingStage.COMPLETED,
        ...terminalPublicCapabilityFields(),
        status: NoteStatus.READ_FAILED,
        version: { increment: 1 },
      },
    });
    if (finalized.count !== 1) {
      throw new AuditPipelineError(
        "AUDIT_CONFLICT",
        "A nota mudou durante a finalização da leitura.",
      );
    }
    await tx.finding.updateMany({
      where: { noteId, status: FindingStatus.OPEN },
      data: { status: FindingStatus.RESOLVED, needsValidation: false },
    });
    await invalidateNoteReads(tx, noteId);
    if (contextSubmissionId) {
      await tx.noteContextSubmission.updateMany({
        where: { id: contextSubmissionId },
        data: { reanalysisCompletedAt: new Date(), status: ContextSubmissionStatus.REANALYSIS_COMPLETED },
      });
    }
    const note = await tx.note.findUniqueOrThrow({
      where: { id: noteId },
      select: { auditResult: true, id: true, status: true },
    });
    await tx.noteEvent.create({
      data: {
        noteId,
        type: "READ_FAILED",
        fromStatus: NoteStatus.PROCESSING,
        toStatus: NoteStatus.READ_FAILED,
        data: { routedToReviewer: false, policyVersion: HARNESS_VERSIONS.policy },
      },
    });
    return note;
  });
}

export async function processNoteAudit(
  noteId: string,
  dependencies: {
    client?: AuditDiscoveryClient;
    contextSubmissionId?: string;
    processingJobId?: string;
  } = {},
) {
  const context = await loadAuditContext(noteId, dependencies.contextSubmissionId);
  if (isReadFailure(context.invoice)) {
    return finalizeReadFailure(
      noteId,
      context.noteVersion,
      dependencies.contextSubmissionId,
    );
  }

  const universal = evaluateUniversalRules({ invoice: context.invoice, duplicates: context.duplicates });
  const work = evaluateWorkRules(context.invoice, context.workRules);
  const deterministicFindings = [...universal.findings, ...work.findings];
  const selectedReasoning = selectReasoningEffort(context.invoice, deterministicFindings);
  const reasoning = {
    ...selectedReasoning,
    effort: resolveAuditReasoningEffort(
      process.env.OPENROUTER_AUDIT_REASONING_EFFORT,
      selectedReasoning.effort,
    ),
  };
  const auditModel = resolveAuditEvaluatorModel(process.env.OPENROUTER_AUDIT_MODEL);
  const canonicalContextAnswers = [...(context.contextAnswers ?? [])].sort(
    (left, right) =>
      `${left.code}:${left.type}`.localeCompare(`${right.code}:${right.type}`),
  );
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify({
      contextAnswers: canonicalContextAnswers,
      contextRound: context.contextRound,
      invoice: context.invoice,
      workRules: context.workRules,
      deterministicFindings,
      versions: HARNESS_VERSIONS,
    }))
    .digest("hex");
  const idempotencyKey = `audit:${dependencies.processingJobId ?? noteId}:${requestFingerprint}`;
  const aiRun = await prisma.aiRun.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      kind: AiRunKind.AUDIT,
      model: auditModel,
      noteId,
      policyVersion: HARNESS_VERSIONS.policy,
      processingJobId: dependencies.processingJobId,
      promptVersion: HARNESS_VERSIONS.prompt,
      reasoningEffort: reasoning.effort === "max" ? ReasoningEffort.MAX : reasoning.effort === "xhigh" ? ReasoningEffort.XHIGH : ReasoningEffort.HIGH,
      requestFingerprint,
      schemaVersion: HARNESS_VERSIONS.schema,
      status: AiRunStatus.RUNNING,
    },
    update: {
      attempts: 1,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      model: auditModel,
      status: AiRunStatus.RUNNING,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  try {
    const client = dependencies.client ?? getOpenRouterAuditDiscoveryClient();
    const discovery = await client.discover({
      contextAnswers: context.contextAnswers,
      invoice: context.invoice,
      deterministicFindings,
      workRules: context.workRules,
      reasoningEffort: reasoning.effort,
    });
    const result = evaluateHarness({ ...context, aiDiscovery: discovery.data });
    const allowNewContextQuestions = !dependencies.contextSubmissionId && context.contextQuestionCount === 0;
    const isFirstAudit = !dependencies.contextSubmissionId && context.contextRound === 0;
    if (result.classification === "NEEDS_CONTEXT" && isFirstAudit && result.contextQuestions.length === 0) {
      throw new AuditPipelineError("AUDIT_CONTEXT_QUESTIONS_MISSING", "A auditoria solicitou contexto sem fornecer perguntas.");
    }
    const supportedFindings = result.findings.filter(isSupportedFinding);
    // O envio público possui uma única rodada de contexto. Depois da resposta,
    // a nota precisa sair de NEEDS_CONTEXT: achados sustentados viram suspeita;
    // sem achado conclusivo, a análise termina como OK.
    const finalClassification =
      dependencies.contextSubmissionId && result.classification === "NEEDS_CONTEXT"
        ? resolvePostContextClassification({
            aiCoverage: result.coverage.ai,
            deterministicCoverage: result.coverage.deterministic,
            findings: result.findings,
          })
        : result.classification;
    const finalContextQuestions = dependencies.contextSubmissionId
      ? []
      : result.contextQuestions;
    const auditResult = auditResultValue(finalClassification);
    const finalStatus = noteStatus(finalClassification);
    const keepsPublicContextCapability =
      finalClassification === "NEEDS_CONTEXT" &&
      !dependencies.contextSubmissionId &&
      (context.contextQuestionCount > 0 ||
        (allowNewContextQuestions && finalContextQuestions.length > 0));
    const targetContextRound =
      finalClassification === "NEEDS_CONTEXT" &&
      allowNewContextQuestions &&
      finalContextQuestions.length > 0
        ? context.contextRound > 0
          ? context.contextRound
          : 1
        : context.contextRound;

    const finalizedNote = await prisma.$transaction(async (tx) => {
      const finalized = await tx.note.updateMany({
        where: {
          id: noteId,
          processingStage: ProcessingStage.ANALYZING,
          status: NoteStatus.PROCESSING,
          version: context.noteVersion,
        },
        data: {
          auditResult,
          classification: classificationValue(finalClassification),
          contextRound: targetContextRound,
          contextSummary: discovery.data.summary,
          failureCode: null,
          failureMessage: null,
          processedAt: new Date(),
          processingStage: ProcessingStage.COMPLETED,
          ...(keepsPublicContextCapability
            ? {
                publicTokenExpiresAt: new Date(
                  Date.now() + PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS * 1_000,
                ),
              }
            : terminalPublicCapabilityFields()),
          status: finalStatus,
          version: { increment: 1 },
        },
      });
      if (finalized.count !== 1) {
        throw new AuditPipelineError(
          "AUDIT_CONFLICT",
          "A nota mudou durante a auditoria; o resultado obsoleto foi descartado.",
        );
      }

      const items = await tx.noteItem.findMany({ where: { noteId }, select: { id: true, lineNumber: true } });
      const itemIds = new Map(items.map((item) => [item.lineNumber, item.id]));
      await tx.finding.updateMany({ where: { noteId, status: FindingStatus.OPEN }, data: { status: FindingStatus.RESOLVED, needsValidation: false } });
      await invalidateNoteReads(tx, noteId);

      if (supportedFindings.length > 0) {
        await tx.finding.createMany({
          data: supportedFindings.map((finding) => ({
            noteId,
            noteItemId: finding.noteItemLineNumber ? itemIds.get(finding.noteItemLineNumber) : undefined,
            // Todos os achados desta decisão pertencem à execução que os
            // consolidou, inclusive os determinísticos. Isso mantém o log
            // administrativo completo sem alterar a origem da regra.
            aiRunId: aiRun.id,
            code: finding.code,
            title: finding.title,
            description: finding.description,
            category: finding.category,
            severity: finding.severity,
            source: FindingSource[finding.source],
            confidence: finding.confidence,
            justification: finding.justification,
            references: toJson(finding.references),
            ruleVersion: finding.source === "AI_DISCOVERY" ? HARNESS_VERSIONS.prompt : finding.source === "WORK_RULE" ? String(finding.evidence.ruleCode ?? HARNESS_VERSIONS.policy) : HARNESS_VERSIONS.policy,
            isNovel: finding.source === "AI_DISCOVERY",
            policyVersion: HARNESS_VERSIONS.policy,
            needsValidation: false,
            evidence: toJson(finding.evidence),
            expectedValue: nullableJson(finding.expectedValue),
            actualValue: nullableJson(finding.actualValue),
          })),
        });
      }

      if (finalClassification === "NEEDS_CONTEXT" && allowNewContextQuestions && finalContextQuestions.length > 0) {
        await tx.noteContextQuestion.createMany({
          data: finalContextQuestions.map((question, index) => ({
            aiRunId: aiRun.id,
            code: question.code,
            noteId,
            options: toJson(question.options),
            position: index + 1,
            prompt: question.prompt,
            rationale: question.rationale,
            required: question.required,
            round: targetContextRound,
            type: question.type,
          })),
        });
      }

      if (dependencies.contextSubmissionId) {
        await tx.noteContextSubmission.update({
          where: { id: dependencies.contextSubmissionId },
          data: { reanalysisCompletedAt: new Date(), status: ContextSubmissionStatus.REANALYSIS_COMPLETED },
        });
      }

      if (finalClassification === "SUSPICIOUS") {
        const reviewers = await tx.profile.findMany({ where: { active: true, role: UserRole.REVIEWER }, select: { id: true } });
        for (const reviewer of reviewers) {
          await createNotificationWithPushDeliveries(tx, {
            body: "O anexo recebeu um diagnóstico que requer consulta.",
            data: toJson({
              auditResult: finalClassification,
              aiRunId: aiRun.id,
              policyVersion: HARNESS_VERSIONS.policy,
            }),
            eventKey: `audit:${aiRun.id}:suspicious`,
            noteId,
            recipientId: reviewer.id,
            title: "Novo diagnóstico disponível",
            type: NotificationType.NOTE_PROCESSED,
          });
        }
      }

      await tx.noteEvent.create({
        data: {
          noteId,
          type: "AUDIT_COMPLETED",
          fromStatus: NoteStatus.PROCESSING,
          toStatus: finalStatus,
          data: toJson({
            aiRunId: aiRun.id,
            auditResult: finalClassification,
            contextQuestionCount: finalContextQuestions.length,
            contextRound: targetContextRound,
            findingCount: supportedFindings.length,
            hasContextAnswers: Boolean(context.contextAnswers?.length),
            coverage: result.coverage,
            policyVersion: HARNESS_VERSIONS.policy,
            reasoningEffort: reasoning.effort,
            reasoningTriggers: reasoning.triggers,
          }),
        },
      });
      await tx.aiRun.update({
        where: { id: aiRun.id },
        data: {
          attempts: discovery.attempts,
          completionTokens: discovery.usage?.completionTokens,
          completedAt: new Date(),
          costUsd: discovery.usage?.costUsd,
          latencyMs: discovery.latencyMs,
          model: discovery.model,
          promptTokens: discovery.usage?.promptTokens,
          provider: discovery.provider,
          status: AiRunStatus.SUCCEEDED,
          structuredResponse: toJson({
            attemptTrace: discovery.attemptTrace,
            auditResult: finalClassification,
            contextQuestionCodes: finalContextQuestions.map((question) => question.code),
            coverage: result.coverage,
            findingCodes: supportedFindings.map((finding) => finding.code),
            summary: discovery.data.summary,
            webSources: discovery.webSources ?? [],
            webSearchRequests: discovery.usage?.webSearchRequests ?? 0,
          }),
          totalTokens: discovery.usage?.totalTokens,
        },
      });
      return tx.note.findUniqueOrThrow({
        where: { id: noteId },
        select: {
          auditResult: true,
          classification: true,
          id: true,
          status: true,
        },
      });
    });

    if (finalClassification === "SUSPICIOUS") {
      try {
        await dispatchPendingPushDeliveries({ noteId });
      } catch {
        // A fila mantém a entrega pendente. O diagnóstico nunca falha por causa do push.
        console.error("Push delivery dispatch failed", {
          code: "PUSH_DISPATCH_FAILED",
          noteId,
        });
      }
    }

    return finalizedNote;
  } catch (error) {
    const failure = getAuditFailureDetails(error);
    await prisma.$transaction(async (transaction) => {
      await transaction.aiRun.update({
        where: { id: aiRun.id },
        data: {
          attempts: failure.attempts,
          completedAt: new Date(),
          errorCode: failure.code,
          errorMessage: failure.message,
          model: failure.model,
          status: AiRunStatus.FAILED,
          structuredResponse: toJson({ attemptTrace: failure.attemptTrace }),
        },
      });
      // A stale result must never overwrite the state produced by a newer
      // processing version. The failed AiRun remains available to ADMIN logs.
      if (failure.code !== "AUDIT_CONFLICT") {
        await transaction.note.updateMany({
          where: {
            id: noteId,
            processingStage: ProcessingStage.ANALYZING,
            status: NoteStatus.PROCESSING,
            version: context.noteVersion,
          },
          data: {
            failureCode: failure.code,
            failureMessage: failure.noteMessage,
            processingStage: ProcessingStage.ANALYZING,
            status: NoteStatus.PROCESSING,
            version: { increment: 1 },
          },
        });
      }
    });
    throw new AuditPipelineError(failure.code, failure.message, { cause: error });
  }
}

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
  HARNESS_MODEL,
  HARNESS_VERSIONS,
  evaluateHarness,
  evaluateUniversalRules,
  evaluateWorkRules,
  isReadFailure,
  isSupportedFinding,
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
  type AuditDiscoveryClient,
} from "@/server/integrations/openrouter";
import {
  PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
  terminalPublicCapabilityFields,
} from "@/server/notes/public-capability";
import { invalidateNoteReads } from "@/server/notes/note-read-invalidation";

export class AuditPipelineError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuditPipelineError";
  }
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
  const activeRules = await prisma.auditRule.findMany({
    where: { active: true, OR: [{ workId: null }, { workId: note.workId }] },
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
    workRules,
  };
}

async function finalizeReadFailure(noteId: string, contextSubmissionId?: string) {
  return prisma.$transaction(async (tx) => {
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
    const note = await tx.note.update({
      where: { id: noteId },
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
  if (isReadFailure(context.invoice)) return finalizeReadFailure(noteId, dependencies.contextSubmissionId);

  const universal = evaluateUniversalRules({ invoice: context.invoice, duplicates: context.duplicates });
  const work = evaluateWorkRules(context.invoice, context.workRules);
  const deterministicFindings = [...universal.findings, ...work.findings];
  const reasoning = selectReasoningEffort(context.invoice, deterministicFindings);
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
      model: HARNESS_MODEL,
      noteId,
      policyVersion: HARNESS_VERSIONS.policy,
      processingJobId: dependencies.processingJobId,
      promptVersion: HARNESS_VERSIONS.prompt,
      reasoningEffort: reasoning.effort === "max" ? ReasoningEffort.MAX : reasoning.effort === "xhigh" ? ReasoningEffort.XHIGH : ReasoningEffort.HIGH,
      requestFingerprint,
      schemaVersion: HARNESS_VERSIONS.schema,
      status: AiRunStatus.RUNNING,
    },
    update: { completedAt: null, errorCode: null, errorMessage: null, status: AiRunStatus.RUNNING, startedAt: new Date() },
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
    const auditResult = auditResultValue(result.classification);
    const finalStatus = noteStatus(result.classification);
    const keepsPublicContextCapability =
      result.classification === "NEEDS_CONTEXT" &&
      !dependencies.contextSubmissionId &&
      (context.contextQuestionCount > 0 ||
        (allowNewContextQuestions && result.contextQuestions.length > 0));

    return await prisma.$transaction(async (tx) => {
      const items = await tx.noteItem.findMany({ where: { noteId }, select: { id: true, lineNumber: true } });
      const itemIds = new Map(items.map((item) => [item.lineNumber, item.id]));
      await tx.finding.updateMany({ where: { noteId, status: FindingStatus.OPEN }, data: { status: FindingStatus.RESOLVED, needsValidation: false } });
      await invalidateNoteReads(tx, noteId);

      if (supportedFindings.length > 0) {
        await tx.finding.createMany({
          data: supportedFindings.map((finding) => ({
            noteId,
            noteItemId: finding.noteItemLineNumber ? itemIds.get(finding.noteItemLineNumber) : undefined,
            aiRunId: finding.source === "AI_DISCOVERY" ? aiRun.id : undefined,
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

      let contextRound = context.contextRound;
      if (result.classification === "NEEDS_CONTEXT" && allowNewContextQuestions && result.contextQuestions.length > 0) {
        contextRound = context.contextRound > 0 ? context.contextRound : 1;
        await tx.noteContextQuestion.createMany({
          data: result.contextQuestions.map((question, index) => ({
            aiRunId: aiRun.id,
            code: question.code,
            noteId,
            options: toJson(question.options),
            position: index + 1,
            prompt: question.prompt,
            rationale: question.rationale,
            required: question.required,
            round: contextRound,
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

      const note = await tx.note.update({
        where: { id: noteId },
        data: {
          auditResult,
          classification: classificationValue(result.classification),
          contextRound,
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
        select: { auditResult: true, classification: true, id: true, status: true },
      });

      if (result.classification === "SUSPICIOUS") {
        const reviewers = await tx.profile.findMany({ where: { active: true, role: UserRole.REVIEWER }, select: { id: true } });
        if (reviewers.length > 0) {
          await tx.notification.createMany({
            data: reviewers.map((reviewer) => ({
              recipientId: reviewer.id,
              noteId,
              type: NotificationType.NOTE_PROCESSED,
              title: "Novo diagnóstico disponível",
              body: "O anexo recebeu um diagnóstico que requer consulta.",
              data: toJson({ auditResult: result.classification, aiRunId: aiRun.id, policyVersion: HARNESS_VERSIONS.policy }),
            })),
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
            auditResult: result.classification,
            contextQuestionCount: result.contextQuestions.length,
            contextRound,
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
            auditResult: result.classification,
            contextQuestionCodes: result.contextQuestions.map((question) => question.code),
            coverage: result.coverage,
            findingCodes: supportedFindings.map((finding) => finding.code),
            summary: discovery.data.summary,
          }),
          totalTokens: discovery.usage?.totalTokens,
        },
      });
      return note;
    });
  } catch (error) {
    await prisma.$transaction(async (transaction) => {
      await transaction.aiRun.update({
        where: { id: aiRun.id },
        data: {
          completedAt: new Date(),
          errorCode: error instanceof AuditPipelineError ? error.code : "AUDIT_PROVIDER_ERROR",
          errorMessage: "A auditoria por IA não pôde ser concluída.",
          status: AiRunStatus.FAILED,
        },
      });
      await transaction.note.updateMany({
        where: {
          id: noteId,
          processingStage: ProcessingStage.ANALYZING,
          status: NoteStatus.PROCESSING,
        },
        data: {
          failureCode: error instanceof AuditPipelineError ? error.code : "AUDIT_PROVIDER_ERROR",
          failureMessage: "A auditoria está temporariamente indisponível.",
          processingStage: ProcessingStage.ANALYZING,
          status: NoteStatus.PROCESSING,
          version: { increment: 1 },
        },
      });
    });
    throw new AuditPipelineError("AUDIT_PROVIDER_ERROR", "A auditoria por IA falhou.", { cause: error });
  }
}

import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  AiRunKind,
  AiRunStatus,
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
  AUDIT_POLICY,
  HARNESS_MODEL,
  HARNESS_VERSIONS,
  evaluateHarness,
  evaluateUniversalRules,
  evaluateWorkRules,
  isReadFailure,
  sanitizeForPersistence,
  selectReasoningEffort,
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
  const values = {
    OK: NoteClassification.OK,
    SUSPICIOUS: NoteClassification.SUSPICIOUS,
    NO_PARAMETER: NoteClassification.NO_PARAMETER,
    READ_FAILED: NoteClassification.INCOMPATIBLE,
  } as const;
  return values[value];
}

function noteStatus(value: HarnessClassification) {
  if (value === "SUSPICIOUS") return NoteStatus.PENDING_VALIDATION;
  if (value === "NO_PARAMETER") return NoteStatus.OK;
  if (value === "READ_FAILED") return NoteStatus.READ_FAILED;
  return NoteStatus.OK;
}

async function loadAuditContext(noteId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
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

  const parsed = invoiceExtractionSchema.safeParse(note.extractedData);
  if (!parsed.success) {
    throw new AuditPipelineError("AUDIT_INVALID_EXTRACTION", "Os dados extraídos não são válidos.", { cause: parsed.error });
  }
  const invoice: HarnessInvoice = parsed.data;
  const activeRules = await prisma.auditRule.findMany({
    where: {
      active: true,
      OR: [{ workId: null }, { workId: note.workId }],
    },
    orderBy: [{ priority: "asc" }, { code: "asc" }],
    select: {
      category: true,
      code: true,
      configuration: true,
      name: true,
      severity: true,
    },
  });
  const workRules: WorkRuleInput[] = activeRules.map((rule) => ({
    ...rule,
    severity: rule.severity,
  }));
  const duplicates = await prisma.note.findMany({
    where: {
      id: { not: note.id },
      supplierTaxId: note.supplierTaxId,
      documentNumber: note.documentNumber,
      totalAmount: note.totalAmount,
      issuedAt: note.issuedAt,
      status: { notIn: [NoteStatus.FAILED, NoteStatus.READ_FAILED] },
    },
    select: {
      documentNumber: true,
      id: true,
      issuedAt: true,
      supplierTaxId: true,
      totalAmount: true,
    },
    take: 20,
  });

  return {
    invoice,
    workRules,
    duplicates: duplicates.map((duplicate) => ({
      noteId: duplicate.id,
      documentNumber: duplicate.documentNumber,
      supplierTaxId: duplicate.supplierTaxId,
      issuedAt: dateOnly(duplicate.issuedAt),
      totalAmount: duplicate.totalAmount?.toString() ?? null,
    })),
  };
}

async function finalizeReadFailure(noteId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.finding.updateMany({
      where: { noteId, status: FindingStatus.OPEN },
      data: { status: FindingStatus.RESOLVED, needsValidation: false },
    });
    const note = await tx.note.update({
      where: { id: noteId },
      data: {
        classification: null,
        failureCode: "READ_FAILED",
        failureMessage: "A leitura não possui qualidade mínima para auditoria.",
        processedAt: new Date(),
        processingStage: ProcessingStage.COMPLETED,
        status: NoteStatus.READ_FAILED,
        version: { increment: 1 },
      },
      select: { id: true, status: true, classification: true },
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
  dependencies: { client?: AuditDiscoveryClient; processingJobId?: string } = {},
) {
  const context = await loadAuditContext(noteId);
  if (isReadFailure(context.invoice)) return finalizeReadFailure(noteId);

  const universal = evaluateUniversalRules({ invoice: context.invoice, duplicates: context.duplicates });
  const work = evaluateWorkRules(context.invoice, context.workRules);
  const deterministicFindings = [...universal.findings, ...work.findings];
  const reasoning = selectReasoningEffort(context.invoice, deterministicFindings);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    invoice: context.invoice,
    workRules: context.workRules,
    deterministicFindings,
    versions: HARNESS_VERSIONS,
  })).digest("hex");
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
      reasoningEffort:
        reasoning.effort === "max"
          ? ReasoningEffort.MAX
          : reasoning.effort === "xhigh"
            ? ReasoningEffort.XHIGH
            : ReasoningEffort.HIGH,
      requestFingerprint,
      schemaVersion: HARNESS_VERSIONS.schema,
      status: AiRunStatus.RUNNING,
    },
    update: {
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      status: AiRunStatus.RUNNING,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  try {
    const client = dependencies.client ?? getOpenRouterAuditDiscoveryClient();
    const discovery = await client.discover({
      invoice: context.invoice,
      deterministicFindings,
      workRules: context.workRules,
      reasoningEffort: reasoning.effort,
    });
    const result = evaluateHarness({ ...context, aiDiscovery: discovery.data });
    const supportedFindings = result.findings.filter((finding) =>
      finding.confidence >= AUDIT_POLICY.supportedFindingThreshold &&
      Object.keys(finding.evidence).length > 0,
    );

    return await prisma.$transaction(async (tx) => {
      const items = await tx.noteItem.findMany({
        where: { noteId },
        select: { id: true, lineNumber: true },
      });
      const itemIds = new Map(items.map((item) => [item.lineNumber, item.id]));
      await tx.finding.updateMany({
        where: { noteId, status: FindingStatus.OPEN },
        data: { status: FindingStatus.RESOLVED, needsValidation: false },
      });

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
            ruleVersion:
              finding.source === "AI_DISCOVERY"
                ? HARNESS_VERSIONS.prompt
                : finding.source === "WORK_RULE"
                  ? String(finding.evidence.ruleCode ?? HARNESS_VERSIONS.policy)
                  : HARNESS_VERSIONS.policy,
            isNovel: finding.source === "AI_DISCOVERY",
            policyVersion: HARNESS_VERSIONS.policy,
            needsValidation: result.classification === "SUSPICIOUS",
            evidence: toJson(finding.evidence),
            expectedValue: nullableJson(finding.expectedValue),
            actualValue: nullableJson(finding.actualValue),
          })),
        });
      }

      const finalStatus = noteStatus(result.classification);
      const note = await tx.note.update({
        where: { id: noteId },
        data: {
          classification: classificationValue(result.classification),
          failureCode: null,
          failureMessage: null,
          processedAt: new Date(),
          processingStage: ProcessingStage.COMPLETED,
          status: finalStatus,
          version: { increment: 1 },
        },
        select: { classification: true, id: true, status: true },
      });

      if (result.classification === "SUSPICIOUS") {
        const reviewers = await tx.profile.findMany({
          where: { active: true, role: { in: [UserRole.REVIEWER, UserRole.ADMIN] } },
          select: { id: true },
        });
        if (reviewers.length > 0) {
          await tx.notification.createMany({
            data: reviewers.map((reviewer) => ({
              recipientId: reviewer.id,
              noteId,
              type: NotificationType.VALIDATION_REQUIRED,
              title: "Nota suspeita requer validação",
              body: `${supportedFindings.length} achado(s) sustentado(s) pelo Harness.`,
              data: toJson({ aiRunId: aiRun.id, policyVersion: HARNESS_VERSIONS.policy }),
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
            classification: result.classification,
            findingCount: supportedFindings.length,
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
            classification: result.classification,
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
    await prisma.$transaction([
      prisma.aiRun.update({
        where: { id: aiRun.id },
        data: {
          completedAt: new Date(),
          errorCode: error instanceof AuditPipelineError ? error.code : "AUDIT_PROVIDER_ERROR",
          errorMessage: "A auditoria por IA não pôde ser concluída.",
          status: AiRunStatus.FAILED,
        },
      }),
      prisma.note.update({
        where: { id: noteId },
        data: {
          failureCode: "AUDIT_PROVIDER_ERROR",
          failureMessage: "A auditoria está temporariamente indisponível.",
          processingStage: ProcessingStage.FAILED,
          status: NoteStatus.FAILED,
          version: { increment: 1 },
        },
      }),
    ]);
    throw new AuditPipelineError("AUDIT_PROVIDER_ERROR", "A auditoria por IA falhou.", { cause: error });
  }
}

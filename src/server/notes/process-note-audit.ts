import "server-only";
import { verifiedExtractionCoverageResolved,
  verifiedSupportCoverageProjection } from "@/lib/audit-harness/verified-extraction-coverage";

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
  buildVerificationChecks,
  evaluateHarness,
  evaluateUniversalRules,
  evaluateWorkRules,
  individuallyConfirmedVerificationFindings,
  isReadFailure,
  isSupportedFinding,
  normalizeVerificationFailureCode,
  resolveAuditEvaluatorModel,
  resolveAuditReasoningEffort,
  resolveAuditAssurance,
  resolveHarnessVerifierMode,
  resolvePostContextClassification,
  sanitizeForPersistence,
  selectReasoningEffort,
  selectVerification,
  type ContextAnswerForAudit,
  type HarnessClassification,
  type WorkRuleInput,
} from "@/lib/audit-harness";
import { parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import { hasCompleteFiscalIdentity, originalFileHash } from "@/lib/audit-harness/duplicate-identity";
import { getContextOnlyCoverageGaps, getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { requiresSourceReview } from "@/lib/audit-harness/source-review";
import { canAuditReadableSubset, missingSupportCoverageReason } from "@/lib/audit-harness/policy";
import { prisma } from "@/server/db/prisma";
import {
  getOpenRouterAuditDiscoveryClient,
  OpenRouterAuditDiscoveryError,
  type AuditDiscoveryClient,
  type AuditDiscoveryResult,
} from "@/server/integrations/openrouter/audit-client";
import { getInvoiceExtractionLimitation, OpenRouterClientError } from "@/server/integrations/openrouter/client";
import type { VerificationClient } from "@/server/integrations/openrouter/verification-client";
import {
  PUBLIC_CONTEXT_CAPABILITY_TTL_SECONDS,
  terminalPublicCapabilityFields,
} from "@/server/notes/public-capability";
import { invalidateNoteReads } from "@/server/notes/note-read-invalidation";
import {
  runSelectiveVerification,
  type IsolatedVerificationRecovery,
  type IsolatedDiscoveryReplay,
  type IsolatedVerificationReplay,
} from "@/server/notes/run-selective-verification";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";
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
          provider: error.provider,
          requestId: error.requestId,
          routingMetadata: error.routingMetadata,
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

function sanitizedText(value: string) {
  const sanitized = sanitizeForPersistence(value);
  return typeof sanitized === "string" ? sanitized : "Resumo indisponível.";
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
  if (value === "INFORMATION_INSUFFICIENT") {
    return NoteClassification.NO_PARAMETER;
  }
  return null;
}

function auditResultValue(value: HarnessClassification) {
  return {
    OK: AuditResult.OK,
    SUSPICIOUS: AuditResult.SUSPICIOUS,
    NEEDS_CONTEXT: AuditResult.NEEDS_CONTEXT,
    // A terminal coverage gap is not a request for context and must never be
    // persisted as an apparently successful review. Keep it on the existing
    // read-failure boundary until the schema has a dedicated inconclusive
    // result, so clients cannot silently render it as OK.
    INFORMATION_INSUFFICIENT: AuditResult.READ_FAILED,
    READ_FAILED: AuditResult.READ_FAILED,
  }[value];
}

function noteStatus(value: HarnessClassification) {
  if (value === "READ_FAILED") return NoteStatus.READ_FAILED;
  if (value === "SUSPICIOUS") return NoteStatus.PENDING_VALIDATION;
  if (value === "NEEDS_CONTEXT") return NoteStatus.PROCESSING;
  if (value === "INFORMATION_INSUFFICIENT") return NoteStatus.READ_FAILED;
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
      originalFileName: true,
      originalFilePath: true,
      originalFileSha256: true,
      originalMimeType: true,
      originalPageCount: true,
      processingStage: true,
      supplierTaxId: true,
      totalAmount: true,
      version: true,
      workId: true,
      aiRuns: {
        where: { kind: AiRunKind.EXTRACTION },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { attempts: true, structuredResponse: true },
      },
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

  const parsed = parseInvoiceExtractionPayload(note.extractedData);
  if (!parsed.success) {
    throw new AuditPipelineError("AUDIT_INVALID_EXTRACTION", "Os dados extraídos não são válidos.", { cause: parsed.error });
  }
  const invoice = { ...parsed.data, originalFileSha256: note.originalFileSha256 };
  const metadata = note.aiRuns[0]?.structuredResponse;
  const recordedLimitation = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata.qualityLimitation : null;
  const currentLimitation = getEvidenceCoverageLimitation(parsed.data, note.originalMimeType === "application/pdf" ? note.originalPageCount : 1) ??
    getInvoiceExtractionLimitation(parsed.data, note.originalMimeType === "application/pdf" ? "application/pdf" : "image/png");
  const extractionLimitation = currentLimitation?.message ??
    (recordedLimitation && typeof recordedLimitation === "object" && !Array.isArray(recordedLimitation)
      ? "A extração anterior não confirmou a cobertura integral do anexo." : null);
  const recordedContextGap = !recordedLimitation || (typeof recordedLimitation === "object" && !Array.isArray(recordedLimitation) &&
    "diagnostic" in recordedLimitation && recordedLimitation.diagnostic === "evidence-source-not-extracted" &&
    "details" in recordedLimitation && recordedLimitation.details && typeof recordedLimitation.details === "object" &&
    !Array.isArray(recordedLimitation.details) && "kind" in recordedLimitation.details && recordedLimitation.details.kind === "OTHER");
  const contextOnlyCoverageGaps = recordedContextGap &&
    !getInvoiceExtractionLimitation(parsed.data, note.originalMimeType === "application/pdf" ? "application/pdf" : "image/png")
    ? getContextOnlyCoverageGaps(parsed.data, note.originalPageCount) : null;
  const workRulesEnabled = process.env.HARNESS_WORK_RULES_ENABLED === "true";
  const activeRules = await prisma.auditRule.findMany({
    where: workRulesEnabled
      ? { active: true, OR: [{ workId: null }, { workId: note.workId }] }
      : { active: true, workId: null },
    orderBy: [{ priority: "asc" }, { code: "asc" }],
    select: { category: true, code: true, configuration: true, name: true, severity: true },
  });
  const workRules: WorkRuleInput[] = activeRules.map((rule) => ({ ...rule, severity: rule.severity }));
  const duplicateFilters: Prisma.NoteWhereInput[] = [];
  if (originalFileHash(note.originalFileSha256)) {
    duplicateFilters.push({ originalFileSha256: note.originalFileSha256 });
  }
  if (hasCompleteFiscalIdentity(invoice)) {
    duplicateFilters.push({
      supplierTaxId: note.supplierTaxId,
      documentNumber: note.documentNumber,
      totalAmount: note.totalAmount,
      issuedAt: note.issuedAt,
    });
  }
  const duplicates = duplicateFilters.length ? await prisma.note.findMany({
    where: {
      id: { not: note.id },
      OR: duplicateFilters,
      status: { notIn: [NoteStatus.FAILED, NoteStatus.READ_FAILED] },
    },
    select: { documentNumber: true, id: true, issuedAt: true, supplierTaxId: true, totalAmount: true, originalFileSha256: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  }) : [];

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
      originalFileSha256: duplicate.originalFileSha256,
      documentNumber: duplicate.documentNumber,
      supplierTaxId: duplicate.supplierTaxId,
      issuedAt: dateOnly(duplicate.issuedAt),
      totalAmount: duplicate.totalAmount?.toString() ?? null,
    })),
    invoice,
    noteVersion: note.version,
    originalFileName: note.originalFileName,
    originalFilePath: note.originalFilePath,
    originalFileSha256: note.originalFileSha256,
    originalMimeType: note.originalMimeType,
    originalPageCount: note.originalPageCount,
    extractionAttempts: note.aiRuns[0]?.attempts ?? 1,
    extractionLimitation,
    extractionLimited: Boolean(extractionLimitation),
    contextOnlyCoverageGaps,
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
        assuranceBand: "LIMITED",
        assuranceReason: "O arquivo não permitiu uma leitura confiável.",
        assuranceVersion: HARNESS_VERSIONS.policy,
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
        data: {
          failureCategory: "DOCUMENT_UNREADABLE",
          routedToReviewer: false,
          policyVersion: HARNESS_VERSIONS.policy,
        },
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
    verificationClient?: VerificationClient;
    isolatedVerificationRecovery?: IsolatedVerificationRecovery;
    isolatedDiscoveryReplay?: IsolatedDiscoveryReplay;
    isolatedVerificationReplay?: IsolatedVerificationReplay;
  } = {},
) {
  const context = await loadAuditContext(noteId, dependencies.contextSubmissionId);
  if (!context.extractionLimitation && isReadFailure(context.invoice)) {
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
  const verifierMode = resolveHarnessVerifierMode(
    process.env.HARNESS_VERIFIER_MODE,
    process.env.HARNESS_VERIFIER_GATE_APPROVED,
  );
  // Partial reading can discover hypotheses in located evidence. It cannot
  // certify whole-document coverage or bypass independent finding confirmation.
  const partialAiAudit = Boolean(context.extractionLimitation) && verifierMode !== "off" &&
    canAuditReadableSubset(context.invoice, context.originalMimeType === "application/pdf" ? context.originalPageCount : 1);
  const skipPaidAudit = Boolean(context.extractionLimitation) && !partialAiAudit;
  const auditModel = skipPaidAudit ? "local/deterministic"
    : resolveAuditEvaluatorModel(process.env.OPENROUTER_AUDIT_MODEL);
  const canonicalContextAnswers = [...(context.contextAnswers ?? [])].sort(
    (left, right) =>
      `${left.code}:${left.type}`.localeCompare(`${right.code}:${right.type}`),
  );
  const auditRequest = {
      contextAnswers: canonicalContextAnswers,
      contextRound: context.contextRound,
      invoice: context.invoice,
      workRules: context.workRules,
      deterministicFindings,
      partialAiAudit,
      versions: HARNESS_VERSIONS,
    };
  const requestFingerprint = createHash("sha256").update(JSON.stringify(auditRequest)).digest("hex");
  const idempotencyKey = `audit:${dependencies.processingJobId ?? noteId}:${requestFingerprint}`;
  const recovery = dependencies.isolatedVerificationRecovery;
  const replay = dependencies.isolatedDiscoveryReplay ?? recovery?.replay;
  if (dependencies.isolatedVerificationReplay && !dependencies.isolatedDiscoveryReplay) {
    throw new AuditPipelineError("AUDIT_REPLAY_CONTEXT_CHANGED", "Revalidação local exige a descoberta original preservada.");
  }
  let replayDiscoverySha256: string | undefined;
  if (recovery || replay) {
    assertIsolatedHarnessTargets();
    const originalAudit = replay ? await prisma.aiRun.findUnique({ where: { id: replay.sourceAuditRunId } }) : null;
    const sourcePolicyVersion = dependencies.isolatedDiscoveryReplay?.sourcePolicyVersion ?? HARNESS_VERSIONS.policy;
    const sourcePromptVersion = dependencies.isolatedDiscoveryReplay?.sourcePromptVersion ?? HARNESS_VERSIONS.prompt;
    const sourceFingerprint = createHash("sha256").update(JSON.stringify({ ...auditRequest,
      versions: { ...HARNESS_VERSIONS, policy: sourcePolicyVersion, prompt: sourcePromptVersion } })).digest("hex");
    if ((dependencies.isolatedDiscoveryReplay && (recovery || (!dependencies.isolatedVerificationReplay &&
      (sourcePolicyVersion === HARNESS_VERSIONS.policy || sourcePromptVersion !== HARNESS_VERSIONS.prompt)))) ||
      !dependencies.client || !replay || !originalAudit || originalAudit.kind !== AiRunKind.AUDIT ||
      originalAudit.status !== AiRunStatus.SUCCEEDED || originalAudit.noteId !== noteId ||
      originalAudit.requestFingerprint !== sourceFingerprint || replay.sourceAuditRequestFingerprint !== sourceFingerprint ||
      originalAudit.policyVersion !== sourcePolicyVersion || originalAudit.promptVersion !== sourcePromptVersion ||
      originalAudit.schemaVersion !== HARNESS_VERSIONS.schema || !/^[a-f0-9]{64}$/.test(replay.sourceReportSha256)) {
      throw new AuditPipelineError("AUDIT_REPLAY_CONTEXT_CHANGED", "O contexto atual difere da auditoria salva; recuperação não iniciada.");
    }
    const record = originalAudit.structuredResponse;
    const snapshotHash = record && typeof record === "object" && !Array.isArray(record) ? record.discoverySnapshotSha256 : undefined;
    if (snapshotHash !== undefined && (typeof snapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(snapshotHash))) {
      throw new AuditPipelineError("AUDIT_REPLAY_CONTEXT_CHANGED", "A auditoria salva não possui um hash de descoberta válido.");
    }
    replayDiscoverySha256 = snapshotHash as string | undefined;
    if (dependencies.isolatedVerificationReplay && !replayDiscoverySha256) {
      throw new AuditPipelineError("AUDIT_REPLAY_CONTEXT_CHANGED", "Revalidação offline exige hash persistido da descoberta.");
    }
  }
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
      reasoningEffort: { low: ReasoningEffort.LOW, medium: ReasoningEffort.MEDIUM, high: ReasoningEffort.HIGH,
        max: ReasoningEffort.MAX, xhigh: ReasoningEffort.XHIGH }[reasoning.effort],
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
    // Unreadable/unlocated input stays local. Readable subsets remain provisional.
    let discoveryFailure: OpenRouterAuditDiscoveryError | undefined;
    const rawDiscovery: AuditDiscoveryResult = skipPaidAudit ? {
      attempts: 0, attemptTrace: [], model: "local/deterministic", provider: "local", latencyMs: 0,
      usage: { costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      data: { findings: [], needsContext: false, contextQuestions: [],
        coverage: { sufficientEvidence: false, checkedAreas: [], limitations: [context.extractionLimitation!] },
        summary: "A leitura ficou incompleta. Foram aplicadas somente regras locais sobre os dados disponíveis; auditoria e verificação por IA não foram executadas." },
    } : await (dependencies.client ?? getOpenRouterAuditDiscoveryClient()).discover({
      contextAnswers: context.contextAnswers,
      invoice: context.invoice,
      deterministicFindings,
      workRules: context.workRules,
      reasoningEffort: reasoning.effort,
      extractionLimitations: context.contextOnlyCoverageGaps ?? undefined,
      extractionLimitationSummary: context.extractionLimitation ?? undefined,
    }).catch((error: unknown): AuditDiscoveryResult => {
      if (!partialAiAudit || !(error instanceof OpenRouterAuditDiscoveryError) ||
        (error.kind !== "timeout" && error.kind !== "invalid-response")) throw error;
      discoveryFailure = error;
      return { attempts: error.attempts, attemptTrace: error.attemptTrace, model: error.model,
        latencyMs: error.latencyMs ?? 0, provider: error.provider, requestId: error.requestId, usage: error.usage,
        data: { findings: [], needsContext: false, contextQuestions: [],
          coverage: { sufficientEvidence: false, checkedAreas: [], limitations: ["A auditoria por IA não concluiu a resposta."] },
          summary: "A leitura disponível foi preservada. A auditoria por IA não concluiu; somente as regras locais produziram este resultado limitado." } };
    });
    if (replayDiscoverySha256 && createHash("sha256").update(JSON.stringify(rawDiscovery.data)).digest("hex") !== replayDiscoverySha256) {
      throw new AuditPipelineError("AUDIT_REPLAY_DISCOVERY_CHANGED", "As hipóteses diferem da descoberta salva; verificação não iniciada.");
    }
    if (dependencies.isolatedVerificationReplay && (rawDiscovery.attempts !== 0 || rawDiscovery.provider !== "local" || rawDiscovery.usage?.costUsd !== 0)) {
      throw new AuditPipelineError("AUDIT_REPLAY_DISCOVERY_CHANGED", "Revalidação offline exige descoberta local sem nova chamada de IA.");
    }
    const discovery: AuditDiscoveryResult = partialAiAudit ? { ...rawDiscovery, data: { ...rawDiscovery.data,
      coverage: { ...rawDiscovery.data.coverage, sufficientEvidence: false,
        limitations: [context.extractionLimitation!, ...rawDiscovery.data.coverage.limitations] },
      summary: discoveryFailure ? rawDiscovery.data.summary : "A auditoria por IA analisou as evidências localizáveis, mas a leitura do conjunto está incompleta. O alcance continua limitado e os apontamentos exigem confirmação no original.",
    } } : rawDiscovery;
    const baseResult = evaluateHarness({ ...context, aiDiscovery: discovery.data });
    const verificationCandidates = [
      ...baseResult.findings,
      ...baseResult.unconfirmedAiFindings,
    ];
    const verificationSelection = selectVerification({
      aiCoverage: baseResult.coverage.ai,
      baseClassification: baseResult.classification,
      baseFindings: verificationCandidates,
      extractionAttempts: context.extractionAttempts,
      extractionRecovered: context.extractionAttempts > 1,
      invoice: context.invoice,
      pageCount: context.originalPageCount,
    });
    const verificationChecks = buildVerificationChecks(context.invoice, verificationCandidates);
    let verification:
      | Awaited<ReturnType<typeof runSelectiveVerification>>
      | undefined;
    let verificationFailed = false;
    let verificationFailureCode: ReturnType<typeof normalizeVerificationFailureCode> | undefined;

    if (!skipPaidAudit && !discoveryFailure && verificationSelection.required && verifierMode !== "off") {
      const verificationMimeType =
        context.originalMimeType === "application/pdf" ||
        context.originalMimeType === "image/jpeg" ||
        context.originalMimeType === "image/png"
          ? context.originalMimeType
          : null;
      if (!verificationMimeType) {
        verificationFailed = true;
        verificationFailureCode = "VERIFICATION_UNSUPPORTED_MIME_TYPE";
      } else try {
        verification = await runSelectiveVerification(
          {
            baseClassification: baseResult.classification,
            expectedChecks: verificationChecks,
            expectedPageCount: context.originalPageCount,
            fileName: context.originalFileName,
            filePath: context.originalFilePath,
            initialFindings: verificationCandidates,
            workRules: context.workRules,
            invoice: context.invoice,
            mimeType: verificationMimeType,
            noteId,
            originalFileSha256: context.originalFileSha256,
            processingJobId: dependencies.processingJobId,
          },
          { client: dependencies.verificationClient, isolatedRecovery: recovery, isolatedReplay: dependencies.isolatedVerificationReplay },
        );
      } catch (error) {
        verificationFailed = true;
        verificationFailureCode = normalizeVerificationFailureCode(
          error && typeof error === "object" && "code" in error ? error.code : undefined,
        );
        // Verificação é uma salvaguarda seletiva. Timeout, resposta inválida ou
        // falha do provedor descartam hipóteses não confirmadas, mas nunca
        // interrompem o processamento nem removem achados determinísticos.
      }
    }

    const explicitlyConfirmedFindings = verification && (baseResult.unconfirmedAiFindings.length > 0 ||
      verificationChecks.some(check => check.amountPair))
      ? individuallyConfirmedVerificationFindings({ expectedChecks: verificationChecks,
          expectedPageCount: context.originalPageCount, initialFindings: verificationCandidates, response: verification.data },
          { requireIndividualTrace: verification.responseRejected })
      : [];
    if (verification?.responseRejected) {
      verificationFailed = true;
      verificationFailureCode = "VERIFICATION_TRACE_INVALID";
    }
    const verificationFindingsForEvaluation =
      verifierMode === "enforce" && verification?.coverage.complete
        ? verification?.data.findings ?? []
        : explicitlyConfirmedFindings;
    const extractionCoverageResolved = Boolean(context.extractionLimitation && verification && !verificationFailed &&
      !discoveryFailure && rawDiscovery.data.coverage.sufficientEvidence && verifiedExtractionCoverageResolved({
        invoice: context.invoice, pageCount: context.originalPageCount, coverageComplete: verification.coverage.complete,
        response: verification.data,
      }));
    const verifiedSupportInvoice = verification && !verificationFailed && !discoveryFailure
      ? verifiedSupportCoverageProjection({ invoice: context.invoice,
          coverageComplete: verification.coverage.complete, response: verification.data })
      : null;
    const supportCoverageResolved = verifiedSupportInvoice !== null;
    const evaluatedResult =
      verificationFindingsForEvaluation.length > 0 || extractionCoverageResolved || supportCoverageResolved
        ? evaluateHarness({
            ...context,
            invoice: verifiedSupportInvoice ?? context.invoice,
            extractionLimited: extractionCoverageResolved ? false : context.extractionLimited,
            aiDiscovery: extractionCoverageResolved ? rawDiscovery.data : discovery.data,
            verificationFindings: verificationFindingsForEvaluation,
          })
        : baseResult;
    const result =
      ((Boolean(context.extractionLimitation) && !extractionCoverageResolved) || (verifierMode === "enforce" &&
      verificationSelection.required &&
      (verificationFailed || !verification?.coverage.complete || verification.data.status === "LIMITED"))) &&
      evaluatedResult.classification === "OK"
        ? { ...evaluatedResult, classification: "INFORMATION_INSUFFICIENT" as const }
        : evaluatedResult;
    const allowNewContextQuestions = !dependencies.contextSubmissionId && context.contextQuestionCount === 0;
    const isFirstAudit = !dependencies.contextSubmissionId && context.contextRound === 0;
    if (result.classification === "NEEDS_CONTEXT" && isFirstAudit && result.contextQuestions.length === 0) {
      throw new AuditPipelineError("AUDIT_CONTEXT_QUESTIONS_MISSING", "A auditoria solicitou contexto sem fornecer perguntas.");
    }
    // Provisional source comparisons stay reviewable, but cannot drive suspicion.
    const visibleFindings = result.findings.filter((finding) =>
      isSupportedFinding(finding) || requiresSourceReview(finding.evidence));
    // O envio público possui uma única rodada de contexto. Depois da resposta,
    // a nota precisa sair de NEEDS_CONTEXT: achados sustentados viram suspeita;
    // sem achado conclusivo e ainda sem base, termina como informação insuficiente.
    const finalClassification =
      dependencies.contextSubmissionId && result.classification === "NEEDS_CONTEXT"
        ? resolvePostContextClassification({
            aiCoverage: result.coverage.ai,
            deterministicCoverage: result.coverage.deterministic,
            findings: result.findings,
            informationInsufficient: true,
          })
        : result.classification;
    const resolvedAssurance = resolveAuditAssurance({
      aiCoverage: result.coverage.ai,
      classification: finalClassification,
      mode: verifierMode,
      selection: verificationSelection,
      verificationCoverageComplete: verification?.coverage.complete,
      verificationFailureCode,
      verificationStatus: verificationFailed
        ? "FAILED"
        : verification?.data.status ?? "NOT_RUN",
    });
    const supportLimitationReason = finalClassification === "INFORMATION_INSUFFICIENT"
      ? missingSupportCoverageReason(context.invoice) : null;
    const assurance = extractionCoverageResolved || supportCoverageResolved ? {
      band: "MEDIUM" as const,
      reason: extractionCoverageResolved
        ? "A conferência independente confirmou as fontes que estavam pendentes no índice da leitura. O diagnóstico considera essas evidências verificadas."
        : "A conferência independente revisou todas as páginas e confirmou que as referências documentais do conjunto estão presentes.",
    } : context.extractionLimitation ? {
      band: "LIMITED" as const,
      reason: discoveryFailure
        ? "A auditoria por IA falhou ao concluir a resposta. A leitura disponível e as comparações locais foram preservadas, mas não houve confirmação independente. Essa falha técnica não comprova falta de informação no documento e não exige resposta do usuário."
        : partialAiAudit
        ? `A auditoria por IA analisou as evidências localizáveis, mas a leitura do conjunto permanece incompleta. ${verification?.coverage.complete ? "A verificação independente foi executada; isso não preenche automaticamente a lacuna da extração." : explicitlyConfirmedFindings.length ? "Foram confirmados achados pontuais em suas próprias fontes, sem comprovar a conferência integral do anexo." : "A verificação independente não confirmou cobertura integral."} Apontamentos sem confirmação são provisórios.`
        : "A leitura ficou incompleta. Auditoria e verificação por IA não foram executadas. Comparações extraídas são provisórias e precisam ser conferidas no original; elas não sustentam classificação suspeita sem confirmação.",
    } : supportLimitationReason ? {
      band: "LIMITED" as const,
      reason: supportLimitationReason,
    } : result.unconfirmedAiFindings.length > 0
      ? {
          band: "LIMITED" as const,
          reason: `${verificationFailed ? `${resolvedAssurance.reason} ` : ""}Uma hipótese da auditoria por IA não teve confirmação independente e não sustenta o diagnóstico.`,
        }
      : resolvedAssurance;
    const finalContextQuestions = dependencies.contextSubmissionId
      ? []
      : result.contextQuestions;
    const auditResult = auditResultValue(finalClassification);
    const finalStatus = noteStatus(finalClassification);
    const supportedFinalFindings = visibleFindings.filter(isSupportedFinding);
    const safeContextSummary =
      supportedFinalFindings.length > 0
        ? sanitizedText(`A conferência identificou ${supportedFinalFindings.length} apontamento(s): ${supportedFinalFindings.map(finding => finding.title).join("; ")}. Consulte as evidências de cada apontamento.`)
      : supportCoverageResolved && verification
        ? sanitizedText(verification.data.summary)
        : extractionCoverageResolved
          ? sanitizedText(rawDiscovery.data.summary)
          : result.unconfirmedAiFindings.length === 0
            ? sanitizedText(discovery.data.summary)
            : finalClassification === "SUSPICIOUS"
              ? "O diagnóstico mantém somente inconsistências sustentadas por regras locais ou pela verificação independente. Sugestões sem confirmação no documento original foram desconsideradas."
              : "A auditoria livre sugeriu uma possível divergência financeira ou de data, mas ela não foi confirmada no documento original e não foi tratada como suspeita.";
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
          assuranceBand: assurance.band,
          assuranceReason: assurance.reason,
          assuranceVersion: HARNESS_VERSIONS.policy,
          classification: classificationValue(finalClassification),
          contextRound: targetContextRound,
          contextSummary: safeContextSummary,
          failureCode:
            finalClassification === "INFORMATION_INSUFFICIENT"
              ? "AUDIT_INSUFFICIENT_COVERAGE"
              : null,
          failureMessage:
            finalClassification === "INFORMATION_INSUFFICIENT"
              ? "A leitura automática não reuniu cobertura suficiente para concluir a auditoria."
              : null,
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

      if (visibleFindings.length > 0) {
        await tx.finding.createMany({
          data: visibleFindings.map((finding) => ({
            noteId,
            noteItemId: finding.noteItemLineNumber ? itemIds.get(finding.noteItemLineNumber) : undefined,
            // Todos os achados desta decisão pertencem à execução que os
            // consolidou, inclusive os determinísticos. Isso mantém o log
            // administrativo completo sem alterar a origem da regra.
            aiRunId:
              finding.source === "AI_VERIFICATION" && verification
                ? verification.runId
                : aiRun.id,
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
              finding.source === "AI_DISCOVERY" ||
              finding.source === "AI_VERIFICATION"
                ? HARNESS_VERSIONS.prompt
                : finding.source === "WORK_RULE"
                  ? String(finding.evidence.ruleCode ?? HARNESS_VERSIONS.policy)
                  : HARNESS_VERSIONS.rules,
            isNovel:
              finding.source === "AI_DISCOVERY" ||
              finding.source === "AI_VERIFICATION",
            policyVersion: HARNESS_VERSIONS.policy,
            needsValidation: requiresSourceReview(finding.evidence),
            evidence: toJson({
              ...finding.evidence,
              comparisonMode:
                finding.comparisonMode ??
                (finding.expectedValue === null ? "CONFLICT" : "REFERENCE"),
              referenceBasis: finding.referenceBasis ?? null,
            }),
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
            findingCount: visibleFindings.length,
            unconfirmedAiFindingCodes: result.unconfirmedAiFindings.map(
              (finding) => finding.code,
            ),
            hasContextAnswers: Boolean(context.contextAnswers?.length),
            coverage: result.coverage,
            assurance,
            policyVersion: HARNESS_VERSIONS.policy,
            reasoningEffort: reasoning.effort,
            reasoningTriggers: reasoning.triggers,
            verification: {
              mode: verifierMode,
              required: verificationSelection.required,
              reasons: verificationSelection.reasons,
              runId: verification?.runId ?? null,
              revalidatedStoredResponse: verification?.revalidated ?? false,
              failureCode: verificationFailureCode ?? null,
              explicitlyConfirmedFindingCodes: explicitlyConfirmedFindings.map(
                (finding) => finding.code,
              ),
              status: verificationFailed
                ? "FAILED"
                : verification?.data.status ?? "NOT_RUN",
            },
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
          status: discoveryFailure ? AiRunStatus.FAILED : AiRunStatus.SUCCEEDED,
          errorCode: discoveryFailure ? getAuditFailureDetails(discoveryFailure).code : null,
          errorMessage: discoveryFailure ? getAuditFailureDetails(discoveryFailure).message : null,
          structuredResponse: toJson({
            replay: replay ?? null,
            replaySnapshotIntegrity: replay ? replayDiscoverySha256 ? "PERSISTED_DISCOVERY_HASH" : "LEGACY_LOCAL_REPORT_ONLY" : null,
            discoverySnapshotSha256: createHash("sha256").update(JSON.stringify(rawDiscovery.data)).digest("hex"),
            attemptTrace: discovery.attemptTrace,
            executionMode: discoveryFailure ? "AI_AUDIT_FAILED_LOCAL_RESULT" : skipPaidAudit ? "DETERMINISTIC_ONLY" : partialAiAudit ? "AI_AUDIT_PARTIAL" : "AI_AUDIT",
            skippedPaidStages: skipPaidAudit ? ["AUDIT", "VERIFICATION"] : discoveryFailure ? ["VERIFICATION"] : [],
            discoveryFailure: discoveryFailure ? { code: getAuditFailureDetails(discoveryFailure).code,
              generationId: discoveryFailure.generationId ?? null, costStatus: discoveryFailure.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN" } : null,
            contextOnlyCoverageGaps: context.contextOnlyCoverageGaps,
            extractionLimitation: context.extractionLimitation,
            extractionCoverageResolvedByVerification: extractionCoverageResolved,
            supportCoverageResolvedByVerification: supportCoverageResolved,
            auditResult: finalClassification,
            contextQuestionCodes: finalContextQuestions.map((question) => question.code),
            coverage: result.coverage,
            findingCodes: visibleFindings.map((finding) => finding.code),
            unconfirmedAiFindingCodes: result.unconfirmedAiFindings.map(
              (finding) => finding.code,
            ),
            invalidWorkRules: work.invalidRules,
            summary: safeContextSummary,
            assurance,
            requestId: discovery.requestId ?? null,
            routing: discovery.routingMetadata ?? null,
            webSources: discovery.webSources ?? [],
            webSearchRequests: discovery.usage?.webSearchRequests ?? 0,
            verification: {
              mode: verifierMode,
              required: verificationSelection.required,
              reasons: verificationSelection.reasons,
              runId: verification?.runId ?? null,
              revalidatedStoredResponse: verification?.revalidated ?? false,
              failureCode: verificationFailureCode ?? null,
              explicitlyConfirmedFindingCodes: explicitlyConfirmedFindings.map(
                (finding) => finding.code,
              ),
              status: verificationFailed
                ? "FAILED"
                : verification?.data.status ?? "NOT_RUN",
            },
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
          structuredResponse: toJson({
            attemptTrace: failure.attemptTrace,
            provider: failure.provider ?? null,
            requestId: failure.requestId ?? null,
            routing: failure.routingMetadata ?? null,
          }),
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

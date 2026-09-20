import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  AiRunKind,
  AiRunStatus,
  ReasoningEffort,
} from "@/generated/prisma/enums";
import {
  HARNESS_VERSIONS,
  buildVerificationChecks,
  isSupportedFinding,
  individuallyConfirmedVerificationFindings,
  resolveHarnessVerifierModel,
  resolveHarnessVerifierReasoningEffort,
  sanitizeForPersistence,
  validateVerificationCoverage,
  verificationResponseSchema,
  type HarnessClassification,
  type HarnessFinding,
  type HarnessInvoice,
  type VerificationCheckRequest,
  type WorkRuleInput,
} from "@/lib/audit-harness";
import { prisma } from "@/server/db/prisma";
import {
  getOpenRouterVerificationClient,
  type VerificationClient,
  type VerificationResult,
} from "@/server/integrations/openrouter/verification-client";
import { OpenRouterClientError } from "@/server/integrations/openrouter/client";
import { safeVerificationSchemaDiagnostics } from "@/server/integrations/openrouter/schema-diagnostics";
import { createInvoiceSignedUrl } from "@/server/storage";
import { resolveAiDocumentSource } from "@/server/storage/ai-document-source";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

function toJson(value: unknown) {
  return sanitizeForPersistence(value) as Prisma.InputJsonValue;
}

export class SelectiveVerificationError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SelectiveVerificationError";
  }
}

export type SelectiveVerificationInput = {
  baseClassification: HarnessClassification;
  expectedChecks: VerificationCheckRequest[];
  expectedPageCount: number | null;
  fileName: string;
  filePath: string;
  initialFindings: HarnessFinding[];
  invoice: HarnessInvoice;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  noteId: string;
  originalFileSha256: string | null;
  processingJobId?: string;
  workRules?: WorkRuleInput[];
};

export type SelectiveVerificationOutput = {
  coverage: ReturnType<typeof validateVerificationCoverage>;
  data: ReturnType<typeof verificationResponseSchema.parse>;
  reused: boolean;
  runId: string;
  responseRejected?: true;
  revalidated?: true;
};

/** Internal local-trial authority, never accepted from an HTTP request. A
 * recovery has one deterministic key; it cannot itself be recovered again. */
export type IsolatedVerificationRecovery = {
  failedRunId: string;
  replay?: { sourceAuditRunId: string; sourceAuditRequestFingerprint: string; sourceReportSha256: string };
};
export type IsolatedDiscoveryReplay = NonNullable<IsolatedVerificationRecovery["replay"]> & { sourcePolicyVersion: string; sourcePromptVersion?: string };
export type IsolatedVerificationReplay = { sourceRunId: string };

function fingerprint(input: SelectiveVerificationInput, versions: { policy: string; prompt: string; schema: string; rules: string } = HARNESS_VERSIONS) {
  // The verifier is tied to the immutable attachment/extraction, not to a
  // context-answer round. A context reanalysis therefore reuses this run and
  // can never buy a second verification call for the same contract version.
  return createHash("sha256")
    .update(JSON.stringify({
      expectedChecks: buildVerificationChecks(input.invoice),
      expectedPageCount: input.expectedPageCount,
      invoice: input.invoice,
      originalFileSha256: input.originalFileSha256,
      versions,
    }))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function workRulesFingerprint(rules: WorkRuleInput[]) {
  if (rules.length === 0) return null;
  return createHash("sha256").update(JSON.stringify(rules.map(canonicalJson).sort())).digest("hex");
}

function assertRuleReferences(findings: HarnessFinding[], workRules: WorkRuleInput[]) {
  if (findings.some(finding => finding.evidence.claimScope === "WORK_AUTHORIZATION" &&
    !workRules.some(rule => finding.references.includes(rule.code)))) {
    throw new SelectiveVerificationError("VERIFICATION_UNSUPPORTED_FINDING",
      "A verificação alegou autorização sem citar uma regra fornecida da obra.");
  }
}

function parseStoredRun(run: { id: string; structuredResponse: Prisma.JsonValue | null }, referenceFingerprint: string | null, workRules: WorkRuleInput[], hypothesisFingerprint: string | null, rejected = false) {
  if (!run.structuredResponse || typeof run.structuredResponse !== "object" || Array.isArray(run.structuredResponse)) {
    throw new SelectiveVerificationError(
      "VERIFICATION_STORED_RESPONSE_INVALID",
      "A execução de verificação existente não possui resposta reutilizável.",
    );
  }
  const record = run.structuredResponse as Record<string, unknown>;
  // Keep the single-call key bound to the immutable attachment. Changed rules
  // invalidate reuse instead of silently authorizing a second paid call.
  if ((record.workRulesFingerprint ?? null) !== referenceFingerprint) {
    throw new SelectiveVerificationError("VERIFICATION_REFERENCE_CHANGED",
      "As regras da obra mudaram desde a verificação; o resultado anterior não foi reutilizado.");
  }
  if ((record.hypothesisFingerprint ?? null) !== hypothesisFingerprint) {
    throw new SelectiveVerificationError("VERIFICATION_HYPOTHESES_CHANGED",
      "As hipóteses mudaram desde a verificação; as decisões anteriores não foram reutilizadas e nenhuma nova chamada foi comprada.");
  }
  const parsed = verificationResponseSchema.safeParse(rejected ? record.rejectedResponse : record.response);
  if (!parsed.success) {
    throw new SelectiveVerificationError(
      "VERIFICATION_STORED_RESPONSE_INVALID",
      "A execução de verificação existente não possui resposta reutilizável.",
      { cause: parsed.error },
    );
  }
  if (!rejected) assertRuleReferences(parsed.data.findings, workRules);
  return parsed.data;
}

function safeFailure(error: unknown) {
  if (error instanceof SelectiveVerificationError) {
    return { code: error.code, message: error.message, latencyMs: undefined, diagnostic: undefined };
  }
  if (error instanceof OpenRouterClientError) {
    if (error.kind === "timeout") {
      return {
        code: "VERIFICATION_TIMEOUT",
        message: "A verificação independente excedeu o tempo limite.",
        provider: error.provider,
        requestId: error.requestId,
        routingMetadata: error.routingMetadata,
        latencyMs: error.latencyMs,
        diagnostic: error.diagnostic,
      };
    }
    if (error.kind === "invalid-response") {
      return {
        code: "VERIFICATION_INVALID_RESPONSE",
        message: "A resposta da verificação independente não passou pelo contrato.",
        provider: error.provider,
        requestId: error.requestId,
        routingMetadata: error.routingMetadata,
        latencyMs: error.latencyMs,
        diagnostic: error.diagnostic,
      };
    }
    return {
      code: error.diagnostic === "provider-endpoint-unavailable" ? "VERIFICATION_ENDPOINT_UNAVAILABLE" : "VERIFICATION_PROVIDER_ERROR",
      message: error.diagnostic === "provider-endpoint-unavailable"
        ? "Não havia rota compatível disponível para a verificação independente."
        : "O provedor não concluiu a verificação independente.",
      provider: error.provider,
      requestId: error.requestId,
      routingMetadata: error.routingMetadata,
      latencyMs: error.latencyMs,
      diagnostic: error.diagnostic,
    };
  }
  return { code: "VERIFICATION_PROVIDER_ERROR", message: "A verificação independente não foi concluída.", latencyMs: undefined, diagnostic: undefined };
}

export async function runSelectiveVerification(
  input: SelectiveVerificationInput,
  dependencies: { client?: VerificationClient; isolatedRecovery?: IsolatedVerificationRecovery; isolatedReplay?: IsolatedVerificationReplay } = {},
): Promise<SelectiveVerificationOutput> {
  // Copy only the same public rule fields sent by the audit. Freeze the request
  // snapshot before asynchronous storage/provider work.
  const workRules: WorkRuleInput[] = JSON.parse(JSON.stringify((input.workRules ?? [])
    .map(({ code, name, category, severity, configuration }) => ({ code, name, category, severity, configuration }))));
  const referenceFingerprint = workRulesFingerprint(workRules);
  const hypothesisFingerprint = input.initialFindings.length
    ? createHash("sha256").update(canonicalJson(input.initialFindings)).digest("hex") : null;
  const requestFingerprint = fingerprint(input);
  const requestContextFingerprint = createHash("sha256").update(canonicalJson({
    baseClassification: input.baseClassification, expectedChecks: input.expectedChecks,
    initialFindings: input.initialFindings, workRules,
  })).digest("hex");
  if (dependencies.isolatedReplay) {
    assertIsolatedHarnessTargets();
    const source = await prisma.aiRun.findUnique({ where: { id: dependencies.isolatedReplay.sourceRunId } });
    const record = source?.structuredResponse;
    if (dependencies.isolatedRecovery || !source || source.noteId !== input.noteId || source.kind !== AiRunKind.VERIFICATION ||
      source.status !== AiRunStatus.SUCCEEDED || source.schemaVersion !== HARNESS_VERSIONS.schema ||
      !record || typeof record !== "object" || Array.isArray(record) || record.requestContextFingerprint !== requestContextFingerprint ||
      source.requestFingerprint !== fingerprint(input, { ...HARNESS_VERSIONS, policy: source.policyVersion, prompt: source.promptVersion })) {
      throw new SelectiveVerificationError("VERIFICATION_RECOVERY_NOT_ALLOWED", "A resposta salva não corresponde ao documento e às hipóteses atuais.");
    }
    const data = parseStoredRun(source, referenceFingerprint, workRules, hypothesisFingerprint);
    // Reinterpret a completed response only; no provider, no new AiRun and no
    // rewritten cost/history. Coverage describes this local validation, not a
    // new independent rereading or a response generated with the new prompt.
    return { coverage: validateVerificationCoverage({ expectedChecks: input.expectedChecks,
      expectedPageCount: input.expectedPageCount, initialFindings: input.initialFindings, response: data }),
      data, reused: true, revalidated: true, runId: source.id };
  }
  const primaryKey = `verify:${input.noteId}:${requestFingerprint}`;
  let idempotencyKey = primaryKey;
  const primary = await prisma.aiRun.findUnique({
    where: { idempotencyKey: primaryKey },
    select: { id: true, kind: true, noteId: true, status: true, structuredResponse: true,
      processingJobId: true, policyVersion: true, promptVersion: true, schemaVersion: true },
  });
  let existing: { id: string; status: AiRunStatus; structuredResponse: Prisma.JsonValue | null } | null = primary;
  const recovery = dependencies.isolatedRecovery;
  if (recovery) {
    assertIsolatedHarnessTargets();
    const rejectRecovery = () => new SelectiveVerificationError("VERIFICATION_RECOVERY_NOT_ALLOWED",
      "A recuperação não corresponde à tentativa original e ao contexto preservado.");
    if (!primary || primary.id !== recovery.failedRunId || primary.kind !== AiRunKind.VERIFICATION ||
      primary.noteId !== input.noteId || primary.status !== AiRunStatus.FAILED ||
      primary.policyVersion !== HARNESS_VERSIONS.policy || primary.promptVersion !== HARNESS_VERSIONS.prompt ||
      primary.schemaVersion !== HARNESS_VERSIONS.schema) throw rejectRecovery();
    const record = primary.structuredResponse && typeof primary.structuredResponse === "object" && !Array.isArray(primary.structuredResponse)
      ? primary.structuredResponse : {};
    if ((record.workRulesFingerprint ?? null) !== referenceFingerprint) throw rejectRecovery();
    if (record.requestContextFingerprint !== undefined) {
      if (record.requestContextFingerprint !== requestContextFingerprint) throw rejectRecovery();
    } else {
      // Legacy failures predate the request-context hash. Require the explicit
      // saved-report provenance plus the successful audit from the SAME job.
      // The audit pipeline independently checks its complete request hash.
      const replay = recovery.replay;
      if (!replay || !/^[a-f0-9]{64}$/.test(replay.sourceReportSha256) || !primary.processingJobId) throw rejectRecovery();
      const audit = await prisma.aiRun.findUnique({ where: { id: replay.sourceAuditRunId },
        select: { kind: true, status: true, noteId: true, processingJobId: true, requestFingerprint: true } });
      if (!audit || audit.kind !== AiRunKind.AUDIT || audit.status !== AiRunStatus.SUCCEEDED || audit.noteId !== input.noteId ||
        audit.processingJobId !== primary.processingJobId || audit.requestFingerprint !== replay.sourceAuditRequestFingerprint) throw rejectRecovery();
    }
    idempotencyKey = `verify-recovery:${primary.id}`;
    existing = await prisma.aiRun.findUnique({ where: { idempotencyKey },
      select: { id: true, status: true, structuredResponse: true } });
  } else if (primary?.status === AiRunStatus.FAILED) {
    // Reading an explicitly recovered result is free. Never start recovery
    // automatically, even if the original request may have cost nothing.
    existing = await prisma.aiRun.findUnique({ where: { idempotencyKey: `verify-recovery:${primary.id}` },
      select: { id: true, status: true, structuredResponse: true } }) ?? primary;
  }
  const requestRecord = { workRulesFingerprint: referenceFingerprint, hypothesisFingerprint, requestContextFingerprint,
    recoveryOfRunId: recovery?.failedRunId ?? null, replay: recovery?.replay ?? null };

  if (existing?.status === AiRunStatus.SUCCEEDED) {
    const data = parseStoredRun(existing, referenceFingerprint, workRules, hypothesisFingerprint);
    return {
      coverage: validateVerificationCoverage({
        expectedChecks: input.expectedChecks,
        expectedPageCount: input.expectedPageCount,
        initialFindings: input.initialFindings,
        response: data,
      }),
      data,
      reused: true,
      runId: existing.id,
    };
  }
  if (existing?.status === AiRunStatus.FAILED && existing.structuredResponse &&
    typeof existing.structuredResponse === "object" && !Array.isArray(existing.structuredResponse) &&
    existing.structuredResponse.rejectedResponse) {
    const data = parseStoredRun(existing, referenceFingerprint, workRules, hypothesisFingerprint, true);
    const validation = { expectedChecks: input.expectedChecks, expectedPageCount: input.expectedPageCount,
      initialFindings: input.initialFindings, response: data };
    if (individuallyConfirmedVerificationFindings(validation, { requireIndividualTrace: true }).length > 0) {
      return { coverage: { ...validateVerificationCoverage(validation), complete: false }, data, reused: true, runId: existing.id, responseRejected: true };
    }
  }
  if (existing) {
    throw new SelectiveVerificationError(
      existing.status === AiRunStatus.RUNNING
        ? "VERIFICATION_IN_PROGRESS"
        : "VERIFICATION_CALL_ALREADY_CONSUMED",
      "A chamada única de verificação deste anexo já foi iniciada ou consumida.",
    );
  }

  const verifierModel = resolveHarnessVerifierModel(
    process.env.OPENROUTER_VERIFIER_MODEL,
  );
  let run;
  try {
    run = await prisma.aiRun.create({
      data: {
        idempotencyKey,
        kind: AiRunKind.VERIFICATION,
        model: verifierModel,
        noteId: input.noteId,
        policyVersion: HARNESS_VERSIONS.policy,
        processingJobId: input.processingJobId,
        promptVersion: HARNESS_VERSIONS.prompt,
        reasoningEffort: resolveHarnessVerifierReasoningEffort(process.env.OPENROUTER_VERIFIER_REASONING_EFFORT) === "medium"
          ? ReasoningEffort.MEDIUM : ReasoningEffort.HIGH,
        requestFingerprint,
        schemaVersion: HARNESS_VERSIONS.schema,
        status: AiRunStatus.RUNNING,
        structuredResponse: toJson(requestRecord),
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.aiRun.findUnique({
        where: { idempotencyKey },
        select: { id: true, status: true, structuredResponse: true },
      });
      if (raced?.status === AiRunStatus.SUCCEEDED) {
        const data = parseStoredRun(raced, referenceFingerprint, workRules, hypothesisFingerprint);
        return {
          coverage: validateVerificationCoverage({
            expectedChecks: input.expectedChecks,
            expectedPageCount: input.expectedPageCount,
            initialFindings: input.initialFindings,
            response: data,
          }),
          data,
          reused: true,
          runId: raced.id,
        };
      }
      throw new SelectiveVerificationError(
        "VERIFICATION_IN_PROGRESS",
        "Outra execução já iniciou a chamada única de verificação.",
        { cause: error },
      );
    }
    throw error;
  }

  let result: VerificationResult | undefined;
  let coverage: ReturnType<typeof validateVerificationCoverage> | undefined;
  try {
    const { signedUrl } = await createInvoiceSignedUrl({
      expiresInSeconds: 30 * 60,
      path: input.filePath,
    });
    const documentSource = await resolveAiDocumentSource({ signedUrl, path: input.filePath,
      mimeType: input.mimeType, fileName: input.fileName });
    result = await (dependencies.client ?? getOpenRouterVerificationClient()).verify({
      baseClassification: input.baseClassification,
      expectedChecks: input.expectedChecks,
      expectedPageCount: input.expectedPageCount,
      fileName: input.fileName,
      initialFindings: input.initialFindings,
      invoice: input.invoice,
      workRules,
      mimeType: input.mimeType,
      signedUrl: documentSource,
    });
    coverage = validateVerificationCoverage({ expectedChecks: input.expectedChecks, expectedPageCount: input.expectedPageCount,
      initialFindings: input.initialFindings, response: result.data });
    const unsupportedFinding = result.data.findings.find(
      (finding) => !isSupportedFinding(finding),
    );
    if (unsupportedFinding) {
      throw new SelectiveVerificationError(
        "VERIFICATION_UNSUPPORTED_FINDING",
        "A verificação independente retornou um achado sem suporte suficiente.",
      );
    }
    if (
      coverage.duplicateKeys.length > 0 ||
      coverage.unknownKeys.length > 0 ||
      coverage.mismatchedCheckKeys.length > 0 ||
      coverage.invalidEvidenceCheckKeys.length > 0 ||
      coverage.invalidPages.length > 0 ||
      coverage.duplicatePages.length > 0 ||
      coverage.invalidConfirmationCodes.length > 0 ||
      coverage.invalidFindingPages.length > 0 ||
      coverage.invalidFindingEvidenceCodes.length > 0 ||
      coverage.unlinkedFindingCodes.length > 0 ||
      coverage.orphanCheckFindingCodes.length > 0
    ) {
      throw new SelectiveVerificationError(
        "VERIFICATION_TRACE_INVALID",
        "A verificação independente não vinculou corretamente linhas, páginas e evidências.",
      );
    }

    assertRuleReferences(result.data.findings, workRules);
    await prisma.aiRun.update({
      where: { id: run.id },
      data: {
        attempts: 1,
        completedAt: new Date(),
        completionTokens: result.usage?.completionTokens,
        costUsd: result.usage?.costUsd,
        latencyMs: result.latencyMs,
        model: result.model,
        promptTokens: result.usage?.promptTokens,
        provider: result.provider,
        status: AiRunStatus.SUCCEEDED,
        structuredResponse: toJson({
          ...requestRecord,
          coverage,
          workRulesFingerprint: referenceFingerprint,
          hypothesisFingerprint,
          workRules,
          costStatus: result.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN",
          requestId: result.requestId ?? null,
          generationId: result.generationId ?? null,
          transport: result.transport ?? null,
          routing: result.routingMetadata ?? null,
          response: result.data,
        }),
        totalTokens: result.usage?.totalTokens,
      },
    });

    return { coverage, data: result.data, reused: false, runId: run.id };
  } catch (error) {
    const failure = safeFailure(error);
    const usage = result?.usage ?? (error instanceof OpenRouterClientError ? error.usage : undefined);
    await prisma.aiRun.updateMany({
      where: { id: run.id, status: AiRunStatus.RUNNING },
      data: {
        attempts: 1,
        completedAt: new Date(),
        errorCode: failure.code,
        errorMessage: failure.message,
        latencyMs: result?.latencyMs ?? failure.latencyMs,
        provider: result?.provider ?? failure.provider ?? null,
        costUsd: usage?.costUsd,
        promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens, totalTokens: usage?.totalTokens,
        status: AiRunStatus.FAILED,
        structuredResponse: toJson({
          ...requestRecord,
          workRulesFingerprint: referenceFingerprint,
          // Quarantine a completed, schema-valid final answer for diagnosis.
          // Never persist partial streams/reasoning and never put it under the
          // reusable `response` key. Only separately validated documentary
          // conflicts can be retained under explicitly limited coverage.
          rejectedResponse: result && verificationResponseSchema.safeParse(result.data).success ? result.data : null,
          rejectedCoverage: coverage ?? null,
          diagnostic: failure.diagnostic ?? null,
          schema: error instanceof OpenRouterClientError ? safeVerificationSchemaDiagnostics(error.diagnosticDetails?.schema) : null,
          httpStatus: error instanceof OpenRouterClientError && Number.isInteger(error.status) &&
            error.status! >= 100 && error.status! <= 599 ? error.status : null,
          costStatus: usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN",
          requestId: result?.requestId ?? failure.requestId ?? null,
          generationId: result?.generationId ?? (error instanceof OpenRouterClientError ? error.generationId : undefined) ?? null,
          transport: result?.transport ?? (error instanceof OpenRouterClientError ? error.diagnosticDetails?.transport : undefined) ?? null,
          routing: failure.routingMetadata ?? null,
        }),
      },
    });
    if (result && coverage && ["VERIFICATION_TRACE_INVALID", "VERIFICATION_UNSUPPORTED_FINDING"].includes(failure.code) &&
      individuallyConfirmedVerificationFindings({ expectedChecks: input.expectedChecks,
        expectedPageCount: input.expectedPageCount, initialFindings: input.initialFindings, response: result.data }, { requireIndividualTrace: true }).length > 0) {
      return { coverage: { ...coverage, complete: false }, data: result.data, reused: false, runId: run.id, responseRejected: true };
    }
    throw new SelectiveVerificationError(failure.code, failure.message, { cause: error });
  }
}

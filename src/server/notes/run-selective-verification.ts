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
  isSupportedFinding,
  resolveHarnessVerifierModel,
  sanitizeForPersistence,
  validateVerificationCoverage,
  verificationResponseSchema,
  type HarnessClassification,
  type HarnessFinding,
  type HarnessInvoice,
  type VerificationCheckRequest,
} from "@/lib/audit-harness";
import { prisma } from "@/server/db/prisma";
import {
  getOpenRouterVerificationClient,
  type VerificationClient,
} from "@/server/integrations/openrouter/verification-client";
import { OpenRouterClientError } from "@/server/integrations/openrouter/client";
import { createInvoiceSignedUrl } from "@/server/storage";

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
};

export type SelectiveVerificationOutput = {
  coverage: ReturnType<typeof validateVerificationCoverage>;
  data: ReturnType<typeof verificationResponseSchema.parse>;
  reused: boolean;
  runId: string;
};

function fingerprint(input: SelectiveVerificationInput) {
  // The verifier is tied to the immutable attachment/extraction, not to a
  // context-answer round. A context reanalysis therefore reuses this run and
  // can never buy a second verification call for the same contract version.
  return createHash("sha256")
    .update(JSON.stringify({
      expectedChecks: input.expectedChecks,
      expectedPageCount: input.expectedPageCount,
      invoice: input.invoice,
      originalFileSha256: input.originalFileSha256,
      versions: HARNESS_VERSIONS,
    }))
    .digest("hex");
}

function parseStoredRun(run: { id: string; structuredResponse: Prisma.JsonValue | null }) {
  if (!run.structuredResponse || typeof run.structuredResponse !== "object" || Array.isArray(run.structuredResponse)) {
    throw new SelectiveVerificationError(
      "VERIFICATION_STORED_RESPONSE_INVALID",
      "A execução de verificação existente não possui resposta reutilizável.",
    );
  }
  const record = run.structuredResponse as Record<string, unknown>;
  const parsed = verificationResponseSchema.safeParse(record.response);
  if (!parsed.success) {
    throw new SelectiveVerificationError(
      "VERIFICATION_STORED_RESPONSE_INVALID",
      "A execução de verificação existente não possui resposta reutilizável.",
      { cause: parsed.error },
    );
  }
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
      code: "VERIFICATION_PROVIDER_ERROR",
      message: "O provedor não concluiu a verificação independente.",
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
  dependencies: { client?: VerificationClient } = {},
): Promise<SelectiveVerificationOutput> {
  const requestFingerprint = fingerprint(input);
  const idempotencyKey = `verify:${input.noteId}:${requestFingerprint}`;
  const existing = await prisma.aiRun.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, structuredResponse: true },
  });

  if (existing?.status === AiRunStatus.SUCCEEDED) {
    const data = parseStoredRun(existing);
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
        reasoningEffort: ReasoningEffort.HIGH,
        requestFingerprint,
        schemaVersion: HARNESS_VERSIONS.schema,
        status: AiRunStatus.RUNNING,
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
        const data = parseStoredRun(raced);
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

  try {
    const { signedUrl } = await createInvoiceSignedUrl({
      expiresInSeconds: 30 * 60,
      path: input.filePath,
    });
    const result = await (dependencies.client ?? getOpenRouterVerificationClient()).verify({
      baseClassification: input.baseClassification,
      expectedChecks: input.expectedChecks,
      expectedPageCount: input.expectedPageCount,
      fileName: input.fileName,
      initialFindings: input.initialFindings,
      invoice: input.invoice,
      mimeType: input.mimeType,
      signedUrl,
    });
    const unsupportedFinding = result.data.findings.find(
      (finding) => !isSupportedFinding(finding),
    );
    if (unsupportedFinding) {
      throw new SelectiveVerificationError(
        "VERIFICATION_UNSUPPORTED_FINDING",
        "A verificação independente retornou um achado sem suporte suficiente.",
      );
    }
    const coverage = validateVerificationCoverage({
      expectedChecks: input.expectedChecks,
      expectedPageCount: input.expectedPageCount,
      initialFindings: input.initialFindings,
      response: result.data,
    });
    if (
      coverage.duplicateKeys.length > 0 ||
      coverage.unknownKeys.length > 0 ||
      coverage.invalidConfirmationCodes.length > 0 ||
      coverage.invalidFindingPages.length > 0 ||
      coverage.unlinkedFindingCodes.length > 0 ||
      coverage.orphanCheckFindingCodes.length > 0
    ) {
      throw new SelectiveVerificationError(
        "VERIFICATION_TRACE_INVALID",
        "A verificação independente não vinculou corretamente checks e achados.",
      );
    }

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
          coverage,
          requestId: result.requestId ?? null,
          routing: result.routingMetadata ?? null,
          response: result.data,
        }),
        totalTokens: result.usage?.totalTokens,
      },
    });

    return { coverage, data: result.data, reused: false, runId: run.id };
  } catch (error) {
    const failure = safeFailure(error);
    await prisma.aiRun.updateMany({
      where: { id: run.id, status: AiRunStatus.RUNNING },
      data: {
        attempts: 1,
        completedAt: new Date(),
        errorCode: failure.code,
        errorMessage: failure.message,
        latencyMs: failure.latencyMs,
        provider: failure.provider ?? null,
        status: AiRunStatus.FAILED,
        structuredResponse: toJson({
          diagnostic: failure.diagnostic ?? null,
          requestId: failure.requestId ?? null,
          routing: failure.routingMetadata ?? null,
        }),
      },
    });
    throw new SelectiveVerificationError(failure.code, failure.message, { cause: error });
  }
}

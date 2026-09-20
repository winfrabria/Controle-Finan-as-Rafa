import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { HARNESS_VERSIONS } from "@/lib/audit-harness/versions";
import { parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import type { InvoiceExtractionResult } from "@/server/integrations/openrouter/client";
import type { getOpenRouterConfig } from "@/server/integrations/openrouter/config";

type Source = { id: string; originalFileSha256: string | null; originalMimeType: string;
  originalPageCount: number | null; claimedVersion: number };

/** A changed original, model, reading policy or contract can never reuse a read. */
export function extractionCheckpointFingerprint(source: Source, config: ReturnType<typeof getOpenRouterConfig>) {
  return createHash("sha256").update(JSON.stringify({
    noteId: source.id, sha256: source.originalFileSha256,
    unverifiedSourceVersion: source.originalFileSha256 ? null : source.claimedVersion,
    mimeType: source.originalMimeType, pageCount: source.originalPageCount,
    versions: HARNESS_VERSIONS,
    reading: [config.model, config.pdfModel, config.fallbackModel, config.pdfFallbackModel,
      config.reasoningEffort, config.pdfReasoningEffort, config.extractionFallbackReasoningEffort,
      config.pdfEngine, config.pdfFallbackEngine, config.extractionPipelineMode,
      config.extractionQualityGateEnabled, config.maxTokens, config.maxAttempts, config.timeoutMs, config.totalTimeoutMs,
      config.largePdfReader, config.visualPdfWindows],
  })).digest("hex");
}

const checkpointSchema = z.object({
  version: z.literal(1), fingerprint: z.string().length(64),
  // Do not let the tolerant legacy parser fill an empty/corrupted checkpoint
  // with defaults and turn it into a supposedly reusable extraction.
  data: z.object({ documentKind: z.string(), items: z.array(z.unknown()),
    markdown: z.string(), readConfidence: z.number(), warnings: z.array(z.string()),
    itemCoverage: z.object({ status: z.string() }).passthrough() }).passthrough(),
  model: z.string().min(1),
  qualityLimitation: z.object({ diagnostic: z.string(), message: z.string(),
    details: z.record(z.string(), z.unknown()).default({}) }).optional(),
});

/** Only validated extraction data is retained, never the raw completion/reasoning. */
export function createExtractionCheckpoint(result: InvoiceExtractionResult, fingerprint: string) {
  return { version: 1 as const, fingerprint, data: result.data, model: result.model,
    ...(result.qualityLimitation ? { qualityLimitation: result.qualityLimitation } : {}) };
}

export function readExtractionCheckpoint(stored: unknown, fingerprint: string): InvoiceExtractionResult | null {
  const checkpoint = checkpointSchema.safeParse(stored);
  if (!checkpoint.success || checkpoint.data.fingerprint !== fingerprint) return null;
  const extraction = parseInvoiceExtractionPayload(checkpoint.data.data);
  if (!extraction.success) return null;
  // The paid attempt remains accounted on its original run. Replay does not
  // double-count its tokens/cost or pretend to make another provider request.
  return { data: extraction.data, model: checkpoint.data.model,
    qualityLimitation: checkpoint.data.qualityLimitation,
    attempts: 0, attemptTrace: [], latencyMs: 0,
    usage: { costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

export function safePersistenceDiagnostic(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && /^(P\d{4}|[0-9A-Z]{5})$/.test(error.code) ? error.code : null;
  // Prisma messages may contain SQL, row values and connection strings.
  return { errorType: error instanceof Error && /^[A-Za-z]{0,60}Error$/.test(error.name) ? error.name : "PersistenceError", code };
}

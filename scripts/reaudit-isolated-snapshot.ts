import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { readLosslessExtractionSnapshot } from "../src/server/testing/isolated-extraction-snapshot";
import { processNoteExtraction } from "../src/server/notes/process-note-extraction";
import { processNoteAudit } from "../src/server/notes/process-note-audit";
import { scheduleNoteReprocess, scheduleNoteAuditRecovery, processProcessingJob } from "../src/server/notes/processing-jobs";
import { AUDIT_EVALUATOR_MODELS, resolveHarnessVerifierReasoningEffort } from "../src/lib/audit-harness/versions";
import { OpenRouterAuditDiscoveryClient } from "../src/server/integrations/openrouter/audit-client";
import { OpenRouterVerificationClient } from "../src/server/integrations/openrouter/verification-client";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { aiDiscoveryResponseSchema, HARNESS_VERSIONS } from "../src/lib/audit-harness";
import type { IsolatedDiscoveryReplay, IsolatedVerificationRecovery, IsolatedVerificationReplay } from "../src/server/notes/run-selective-verification";

const savedReauditSchema = z.object({
  scope: z.literal("ISOLATED_PAID_AUDIT_NO_NEW_EXTRACTION"),
  discovery: z.object({ data: aiDiscoveryResponseSchema }),
  after: z.object({ id: z.string().uuid(), version: z.number().int().positive(), processingStage: z.literal("COMPLETED"),
    originalFileSha256: z.string().regex(/^[a-f0-9]{64}$/), extractedData: z.unknown(),
    aiRuns: z.array(z.object({ id: z.string().uuid(), kind: z.string(), status: z.string(),
      processingJobId: z.string().uuid(), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      policyVersion: z.string(), promptVersion: z.string(), schemaVersion: z.string() })),
  }),
});

/** Explicit local re-audit: replay the exact persisted read, never buy a new
 * extraction or upgrade its assurance. Keep a complete private rollback snapshot. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, target, option] = process.argv.slice(2);
  assert(["--online", "--recover", "--recover-verifier", "--recheck-snapshot", "--revalidate-snapshot"].includes(mode) && process.argv.length <= 5);
  const recoveringVerifier = mode === "--recover-verifier";
  const recheckingPolicy = mode === "--recheck-snapshot";
  const offlineRevalidation = mode === "--revalidate-snapshot";
  const replayingDiscovery = recoveringVerifier || recheckingPolicy || offlineRevalidation;
  let saved: z.infer<typeof savedReauditSchema> | undefined;
  let isolatedVerificationRecovery: IsolatedVerificationRecovery | undefined;
  let isolatedDiscoveryReplay: IsolatedDiscoveryReplay | undefined;
  let isolatedVerificationReplay: IsolatedVerificationReplay | undefined;
  if (replayingDiscovery) {
    assert(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(target));
    assert(recoveringVerifier ? option : option === undefined);
    const bytes = await readFile(resolve("tmp", `reaudit-snapshot-${target}.json`));
    saved = savedReauditSchema.parse(JSON.parse(bytes.toString("utf8")));
    assert.equal(saved.scope, "ISOLATED_PAID_AUDIT_NO_NEW_EXTRACTION");
    assert.equal(saved.after.processingStage, "COMPLETED");
    const failed = saved.after.aiRuns.find((run: { id: string }) => run.id === option);
    const audit = saved.after.aiRuns.find((run: { kind: string }) => run.kind === "AUDIT");
    assert(audit?.status === "SUCCEEDED");
    if (recoveringVerifier) {
      assert(failed?.kind === "VERIFICATION" && failed.status === "FAILED");
      assert.equal(failed.processingJobId, audit.processingJobId);
    } else if (!offlineRevalidation) {
      assert.notEqual(audit.policyVersion, HARNESS_VERSIONS.policy, "A policy recheck requires a material policy change, not another retry.");
    }
    for (const run of recoveringVerifier ? [failed!, audit] : [audit]) {
      if (recoveringVerifier) assert.equal(run.policyVersion, HARNESS_VERSIONS.policy);
      if (!offlineRevalidation) assert.equal(run.promptVersion, HARNESS_VERSIONS.prompt);
      assert.equal(run.schemaVersion, HARNESS_VERSIONS.schema);
    }
    aiDiscoveryResponseSchema.parse(saved.discovery.data);
    const replay = { sourceAuditRunId: audit.id, sourceAuditRequestFingerprint: audit.requestFingerprint,
      sourceReportSha256: createHash("sha256").update(bytes).digest("hex") };
    if (recoveringVerifier) isolatedVerificationRecovery = { failedRunId: option!, replay };
    else isolatedDiscoveryReplay = { ...replay, sourcePolicyVersion: audit.policyVersion, sourcePromptVersion: audit.promptVersion };
    if (offlineRevalidation) {
      const verified = saved.after.aiRuns.find(run => run.kind === "VERIFICATION" && run.status === "SUCCEEDED");
      assert(verified && verified.processingJobId === audit.processingJobId, "A complete saved verifier response from the same job is required.");
      isolatedVerificationReplay = { sourceRunId: verified.id };
    }
  }
  const id = saved?.after.id ?? target;
  const model = replayingDiscovery ? undefined : option;
  if (model) assert((AUDIT_EVALUATOR_MODELS as readonly string[]).includes(model));
  assert(process.env.HARNESS_VERIFIER_MODE === "shadow", "This local trial must not promote verifier enforcement.");
  const note = await prisma.note.findFirstOrThrow({ where: { id, work: { code: "LOCAL-104" } },
    include: { items: true, findings: true, aiRuns: { orderBy: { createdAt: "desc" } } } });
  assert.equal(note.processingStage, mode === "--recover" ? "FAILED" : "COMPLETED");
  assert.equal(note.originalMimeType, "application/pdf");assert(note.originalFileSha256);
  // This is a replay, not another extraction normalization. Refuse before any
  // job/provider call if defaults or legacy coercion would change the snapshot.
  const extractionSnapshot = readLosslessExtractionSnapshot(note.extractedData);
  if (replayingDiscovery) {
    assert(saved);
    assert.equal(note.version, saved.after.version, "The saved snapshot is no longer the current note.");
    assert.equal(note.originalFileSha256, saved.after.originalFileSha256);
    assert.deepEqual(note.extractedData, saved.after.extractedData);
  }
  if (recoveringVerifier) {
    const failed = note.aiRuns.find(run => run.id === isolatedVerificationRecovery!.failedRunId);
    assert(failed?.status === "FAILED" && failed.kind === "VERIFICATION");
    assert.equal(await prisma.aiRun.count({ where: { idempotencyKey: `verify-recovery:${failed.id}` } }), 0,
      "This explicit recovery was already consumed; do not repurchase or reprocess.");
  }
  const run = randomUUID();
  const auditConfig = getOpenRouterConfig(process.env, "audit");
  const verifierConfig = getOpenRouterConfig(process.env, "verification");
  const reportPath = resolve("tmp", `reaudit-snapshot-${run}.json`);
  const report: Record<string, unknown> = { scope: "ISOLATED_PAID_AUDIT_NO_NEW_EXTRACTION", before: note,
    mode, recovery: isolatedVerificationRecovery ?? null, replay: isolatedDiscoveryReplay ?? null,
    verificationReplay: isolatedVerificationReplay ?? null,
    versions: HARNESS_VERSIONS, maximumDiscoveryAttempts: replayingDiscovery ? 0 : 1,
    maximumVerificationAttempts: offlineRevalidation ? 0 : 1, discoveryMaxTokens: auditConfig.maxTokens,
    discoveryTimeoutMs: auditConfig.timeoutMs, verifierTimeoutMs: verifierConfig.timeoutMs };
  const save = () => writeFile(reportPath, JSON.stringify(report, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
  await save();
  const auditClient = new OpenRouterAuditDiscoveryClient({ ...auditConfig,
    ...(model ? { model } : {}), maxAttempts: 1, webSearchEnabled: false });
  const verificationClient = new OpenRouterVerificationClient({ ...verifierConfig,
    reasoningEffort: resolveHarnessVerifierReasoningEffort(process.env.OPENROUTER_VERIFIER_REASONING_EFFORT) });
  const recordedAuditClient = { discover: async (request: Parameters<typeof auditClient.discover>[0]) => {
    if (replayingDiscovery) {
      assert(saved);
      const result = { data: aiDiscoveryResponseSchema.parse(saved.discovery.data), model: "local/persisted-discovery-replay",
        provider: "local", attempts: 0, attemptTrace: [], latencyMs: 0,
        usage: { costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      report.discovery = result; await save(); return result;
    }
    const result = await auditClient.discover(request);
    // Private final structured output only, never provider reasoning. Preserve
    // the exact hypotheses so later diagnostics need not repurchase discovery.
    report.discovery = result; await save(); return result;
  } };
  const recordedVerificationClient = { verify: async (request: Parameters<typeof verificationClient.verify>[0]) => {
    assert(!offlineRevalidation, "OFFLINE_REVALIDATION_CANNOT_CALL_A_PROVIDER");
    const input = { ...request, signedUrl: undefined };
    report.verificationInput = input; await save();
    const result = await verificationClient.verify(request);
    report.verificationResult = result; await save(); return result;
  } };
  const workerId = `snapshot-reaudit:${run}`;
  const job = mode === "--recover" ? await scheduleNoteAuditRecovery(note.id)
    : await scheduleNoteReprocess(note.id, { isolatedManualWorkerId: workerId });
  report.jobId = job.id;await save();
  console.log(JSON.stringify({ stage: "STARTED", noteId: note.id, report: reportPath }));
  try {
    await processProcessingJob(job.id, { workerId,
      processExtraction: (noteId, dependencies) => processNoteExtraction(noteId, { ...dependencies, client: {
        extractInvoice: async request => {
          assert.equal(noteId, note.id);
          assert(request.signedUrl.startsWith("data:application/pdf;base64,"));
          assert.equal(createHash("sha256").update(Buffer.from(request.signedUrl.split(",")[1], "base64")).digest("hex"), note.originalFileSha256);
          return { data: extractionSnapshot, model: "local/persisted-snapshot-replay", provider: "local", attempts: 0,
            attemptTrace: [], latencyMs: 0, usage: { costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            qualityLimitation: { diagnostic: "snapshot-replay-unverified", message: "Leitura anterior reutilizada sem certificação de cobertura.",
              details: { sourceNoteVersion: note.version, independentlyVerified: false } } };
        },
      } }),
      processAudit: (noteId, dependencies) => processNoteAudit(noteId, { ...dependencies, client: recordedAuditClient,
        verificationClient: recordedVerificationClient, isolatedVerificationRecovery, isolatedDiscoveryReplay, isolatedVerificationReplay }),
    });
  } finally {
    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id }, include: {
      findings: { where: { status: "OPEN" } }, aiRuns: { where: { processingJobId: job.id } }, contextQuestions: true } });
    report.after = after;await save();
    console.log(JSON.stringify({ noteId: note.id, stage: after.processingStage, classification: after.classification,
      assurance: after.assuranceBand, findings: after.findings.map(finding => finding.code),
      runs: after.aiRuns.map(item => ({ kind: item.kind, model: item.model, status: item.status, latencyMs: item.latencyMs, costUsd: item.costUsd })) }));
    assert.deepEqual(after.extractedData, note.extractedData, "Re-audit must not rewrite the persisted extraction.");
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Re-audit failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

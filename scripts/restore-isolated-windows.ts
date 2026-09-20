import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { materializeWindowAssociation, type ExtractionWindow } from "../src/lib/integrations/openrouter/window-consolidation";
import { remapWindowEvidence } from "../src/lib/integrations/openrouter/page-windows";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "../src/lib/integrations/openrouter/evidence-coverage";
import { processNoteExtraction } from "../src/server/notes/process-note-extraction";
import { processNoteAudit } from "../src/server/notes/process-note-audit";
import { scheduleNoteReprocess, processProcessingJob } from "../src/server/notes/processing-jobs";

const reportJson = (value: unknown) => JSON.stringify(value,
  (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2);

/** Explicit import of legacy page reads into a LIMITED local diagnosis. Not a
 * verified cache hit: source hashes and schema are checked, but old semantics
 * are never certified as current. No AI client is allowed to make a call. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, associationId] = process.argv.slice(2);
  assert(["--preview", "--verify", "--restore-limited"].includes(mode) && process.argv.length === 4);
  // This explicit restoration command promises zero provider calls, even when
  // the normal runtime supports auditing a readable subset.
  if (mode === "--restore-limited") process.env.HARNESS_VERIFIER_MODE = "off";
  assert(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(associationId));
  const associationPath = resolve("tmp", `window-association-${associationId}.json`);
  const association = JSON.parse(await readFile(associationPath, "utf8"));
  const note = await prisma.note.findFirstOrThrow({ where: { id: association.noteId, work: { code: "LOCAL-104" } },
    include: { items: true, findings: true, aiRuns: true } });
  assert.equal(note.originalFileSha256, association.originalSha256);
  assert.equal(note.originalMimeType, "application/pdf");
  assert(note.originalPageCount && note.originalPageCount <= 32);
  assert(Array.isArray(association.checkpoints) && association.checkpoints.length > 0 && association.checkpoints.length <= 8);
  const windows: ExtractionWindow[] = [];
  const seen = new Set<string>();
  for (const entry of association.checkpoints) {
    assert(typeof entry.file === "string" && entry.file === basename(entry.file));
    assert(entry.file.startsWith(`window-read-${association.runId}-${note.id}-`) && entry.file.endsWith(".json"));
    assert(!seen.has(entry.file)); seen.add(entry.file);
    const path = resolve("tmp", entry.file);
    assert((await stat(path)).size <= 1_000_000);
    const bytes = await readFile(path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    const event = JSON.parse(bytes.toString("utf8"));
    assert(event.stage === "WINDOW" && event.status === "COMPLETED");
    assert.equal(event.originalSha256, note.originalFileSha256);
    windows.push({ pages: event.pages, data: remapWindowEvidence(event.result.data, event.pages, note.originalPageCount) });
  }
  windows.sort((a, b) => a.pages[0] - b.pages[0]);
  const materialized = materializeWindowAssociation(windows,
    association.result?.consolidationPlan ?? JSON.parse(association.error.recoveryDraft), note.originalPageCount);
  const limitation = getEvidenceCoverageLimitation(materialized.data, note.originalPageCount);
  assert.equal(materialized.data.itemCoverage.status, "UNKNOWN");
  const summary = { mode, noteId: note.id, previousVersion: note.version, previousStage: note.processingStage,
    items: materialized.data.items.length, economicItems: materialized.data.items.filter(item => item.countsTowardDocumentTotal).length,
    pages: note.originalPageCount, limitation, providerCalls: 0, independentlyVerified: false };
  if (mode === "--preview") { console.log(JSON.stringify(summary)); return; }
  if (mode === "--verify") {
    const stored = parseInvoiceExtractionPayload(note.extractedData);
    assert(stored.success);
    assert.deepEqual(stored.data, materialized.data);
    assert.equal(note.items.length, materialized.data.items.length);
    assert.equal(note.processingStage, "COMPLETED");
    assert.equal(note.classification, "NO_PARAMETER");
    assert.equal(note.auditResult, "NEEDS_CONTEXT");
    assert.equal(note.assuranceBand, "LIMITED");
    const questions = await prisma.noteContextQuestion.count({ where: { noteId: note.id, round: note.contextRound } });
    assert.equal(questions, 0);
    const latest = note.aiRuns.filter(run => run.kind === "EXTRACTION").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    assert.equal(latest.model, "local/saved-window-recovery");
    assert.equal(latest.attempts, 0);
    console.log(JSON.stringify({ ...summary, verified: true, exactSavedDataPreserved: true,
      classification: note.classification, auditResult: note.auditResult, assurance: note.assuranceBand, questions }));
    return;
  }
  assert.equal(note.processingStage, "FAILED", "Do not overwrite a completed or active analysis.");
  assert.equal(note.status, "FAILED");
  const reportPath = resolve("tmp", `restored-windows-${randomUUID()}.json`);
  const report: Record<string, unknown> = { ...summary, sourceAssociationId: associationId, before: note };
  await writeFile(reportPath, reportJson(report), { flag: "wx" });
  let attemptedProviderCalls = 0;
  const noProvider = async (): Promise<never> => { attemptedProviderCalls++; throw new Error("Provider disabled during saved-window restoration."); };
  const job = await scheduleNoteReprocess(note.id);
  try {
    await processProcessingJob(job.id, { workerId: `saved-window-restore:${job.id}`,
      processExtraction: (id, dependencies) => processNoteExtraction(id, { ...dependencies, client: {
        extractInvoice: async request => {
          assert.equal(id, note.id);
          assert(request.signedUrl.startsWith("data:application/pdf;base64,"));
          assert.equal(createHash("sha256").update(Buffer.from(request.signedUrl.split(",")[1], "base64")).digest("hex"), note.originalFileSha256);
          return { data: materialized.data, model: "local/saved-window-recovery", provider: "local",
            attempts: 0, attemptTrace: [], latencyMs: 0,
            usage: { costUsd: 0, completionTokens: 0, promptTokens: 0, totalTokens: 0 },
            qualityLimitation: { diagnostic: "saved-window-unverified", message: "Leituras anteriores recuperadas; cobertura e associações ainda não verificadas.",
              details: { sourceAssociationId: associationId, sourceRunId: association.runId, sourceCheckpoints: association.checkpoints,
                currentLimitation: limitation, independentlyVerified: false } } };
        },
      } }),
      processAudit: (id, dependencies) => processNoteAudit(id, { ...dependencies,
        client: { discover: noProvider }, verificationClient: { verify: noProvider } }),
    });
    const after = await prisma.note.findUniqueOrThrow({ where: { id: note.id }, include: { items: true, findings: { where: { status: "OPEN" } } } });
    Object.assign(report, { after, attemptedProviderCalls });
    assert.equal(attemptedProviderCalls, 0);
    assert.equal(after.processingStage, "COMPLETED");
    // Persistence uses the legacy enum; the Harness classification is mapped
    // to NO_PARAMETER + NEEDS_CONTEXT, not to a conclusive approval.
    assert.equal(after.classification, "NO_PARAMETER");
    assert.equal(after.auditResult, "NEEDS_CONTEXT");
    assert.equal(after.items.length, materialized.data.items.length);
    console.log(JSON.stringify({ ...summary, report: reportPath, currentVersion: after.version, currentStage: after.processingStage,
      classification: after.classification, findings: after.findings.map(finding => finding.code), attemptedProviderCalls }));
  } finally {
    await writeFile(reportPath, reportJson(report));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Restoration failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

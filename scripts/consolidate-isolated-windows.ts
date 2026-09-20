import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { OpenRouterClientError, OpenRouterInvoiceExtractionClient, type InvoiceExtractionResult } from "../src/server/integrations/openrouter/client";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { remapWindowEvidence } from "../src/lib/integrations/openrouter/page-windows";
import { materializeWindowAssociation, validateExtractionWindows, windowConsolidationPrompt, windowSourceCatalog,
  type ExtractionWindow } from "../src/lib/integrations/openrouter/window-consolidation";

/** Reuse durable page reads. No PDF upload, visual reread, diagnosis mutation or
 * verifier call. One bounded text request only with --online and local budget. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, runId, noteId, replayId] = process.argv.slice(2);
  assert(mode === "--offline" || mode === "--online" || mode === "--replay");
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
  assert(uuid.test(runId) && uuid.test(noteId));
  const note = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } },
    select: { originalFileSha256: true, originalPageCount: true } });
  assert(note.originalFileSha256 && note.originalPageCount);
  const prefix = `window-read-${runId}-${noteId}-`;
  const files = (await readdir(resolve("tmp"))).filter(file => file.startsWith(prefix) && file.endsWith(".json"));
  assert(files.length > 0 && files.length <= 32);
  const windows: ExtractionWindow[] = [], checkpoints: Array<{ file: string; sha256: string }> = [];
  for (const file of files) {
    const path = resolve("tmp", file);
    assert((await stat(path)).size <= 1_000_000);
    const bytes = await readFile(path);
    const event = JSON.parse(bytes.toString("utf8"));
    if (event.stage !== "WINDOW" || event.status !== "COMPLETED") continue;
    assert.equal(event.originalSha256, note.originalFileSha256);
    windows.push({ pages: event.pages, data: remapWindowEvidence(event.result.data, event.pages, note.originalPageCount) });
    checkpoints.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  windows.sort((a, b) => a.pages[0] - b.pages[0]);
  validateExtractionWindows(windows, note.originalPageCount);
  // Prove that no-model materialization is lossless before spending anything.
  const baseline = materializeWindowAssociation(windows, { headerWindow: 1, economicItemRefs: [], groups: [], parents: [] }, note.originalPageCount);
  const summary = { mode, noteId, runId, windowCount: windows.length,
    items: baseline.data.items.length, sourceOccurrences: windowSourceCatalog(windows).length,
    promptCharacters: windowConsolidationPrompt(windows, note.originalPageCount).length,
    originalSha256: note.originalFileSha256, databaseMutations: 0, pdfUploads: 0 };
  if (mode === "--offline") { console.log(JSON.stringify({ ...summary, providerCalls: 0 })); return; }
  if (mode === "--replay") {
    assert(uuid.test(replayId));
    const previous = JSON.parse(await readFile(resolve("tmp", `window-association-${replayId}.json`), "utf8"));
    assert.equal(previous.noteId, noteId); assert.equal(previous.runId, runId);
    assert.equal(previous.originalSha256, note.originalFileSha256);
    assert.deepEqual(previous.checkpoints, checkpoints);
    const result = materializeWindowAssociation(windows, previous.result?.consolidationPlan ?? JSON.parse(previous.error.recoveryDraft), note.originalPageCount);
    const path = resolve("tmp", `window-association-replay-${randomUUID()}.json`);
    await writeFile(path, JSON.stringify({ ...summary, providerCalls: 0, sourceReportId: replayId,
      status: "MATERIALIZED_LIMITED", result }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ ...summary, providerCalls: 0, status: "MATERIALIZED_LIMITED", path,
      economicItems: result.data.items.filter(item => item.countsTowardDocumentTotal).length, groups: result.plan.groups.length }));
    return;
  }

  const budgetPath = resolve("tmp/budget-new-20260908.json");
  const lockPath = resolve("tmp/consolidation-budget.lock");
  const reportPath = resolve("tmp", `window-association-${randomUUID()}.json`);
  await writeFile(lockPath, JSON.stringify({ reportPath, startedAt: new Date().toISOString() }), { flag: "wx" });
  let reserved = false, accountingCompleted = false;
  try {
    const budget = JSON.parse(await readFile(budgetPath, "utf8"));
    assert.equal(budget.authorizedUsd, 7);
    assert(Number.isFinite(budget.reservedUsd) && budget.reservedUsd >= 0);
    assert(Number.isFinite(budget.knownCostUsd) && budget.knownCostUsd >= 0);
    assert(Math.max(budget.knownCostUsd, budget.sharedKeyDeltaObservedUsd ?? 0) + budget.reservedUsd + 1 <= budget.authorizedUsd);
    budget.reservedUsd += 1;
    budget.reservationNote = "USD1 reserved for one text-only association call; prior unknown-cost reservations retained.";
    await writeFile(budgetPath, JSON.stringify(budget, null, 2));
    reserved = true;
    const report: Record<string, unknown> = { ...summary, scope: "EXPERIMENT_ONLY_NO_DATABASE_MUTATION",
      status: "STARTED", checkpoints, startedAt: new Date().toISOString() };
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ ...summary, reportPath, status: "STARTED", providerCalls: 1 }));
    let result: InvoiceExtractionResult | undefined, failure: OpenRouterClientError | undefined;
    const startedAt = Date.now();
    try {
      const config = getOpenRouterConfig(process.env, "extraction");
      const client = new OpenRouterInvoiceExtractionClient({ ...config, maxAttempts: 1, maxTokens: 8192,
        timeoutMs: 30_000, totalTimeoutMs: 30_000, extractionQualityGateEnabled: true });
      result = await client.extractInvoice({ fileName: "saved-window-association", mimeType: "application/pdf",
        pageCount: note.originalPageCount, signedUrl: "", visualWindows: windows });
      Object.assign(report, { status: "MATERIALIZED_LIMITED", result });
    } catch (error) {
      failure = error instanceof OpenRouterClientError ? error : undefined;
      Object.assign(report, { status: "FAILED", error: failure ? { kind: failure.kind, diagnostic: failure.diagnostic,
        diagnosticDetails: failure.diagnosticDetails, recoveryDraft: failure.recoveryDraft,
        usage: failure.usage, attemptTrace: failure.attemptTrace, requestId: failure.requestId } : { kind: "LOCAL_FAILURE" } });
      process.exitCode = 1;
    }
    Object.assign(report, { latencyMs: Date.now() - startedAt, endedAt: new Date().toISOString() });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    const telemetry = result ?? failure;
    const known = telemetry?.usage?.costUsd;
    const allKnown = telemetry?.attemptTrace?.length === 1 && telemetry.attemptTrace[0].costStatus === "KNOWN" &&
      known !== undefined && Number.isFinite(known) && known >= 0;
    const latest = JSON.parse(await readFile(budgetPath, "utf8"));
    if (allKnown) { latest.reservedUsd -= 1; latest.knownCostUsd += known; }
    latest.associationRuns = [...(latest.associationRuns ?? []), { report: reportPath, status: report.status,
      knownCostUsd: known ?? null, retainedUnknownReservationUsd: allKnown ? 0 : 1, latencyMs: report.latencyMs }];
    latest.reservationNote = "No active consolidation request. Unknown-cost reservations remain; do not reread PDF windows for association experiments.";
    await writeFile(budgetPath, JSON.stringify(latest, null, 2));
    accountingCompleted = true;
    console.log(JSON.stringify({ status: report.status, latencyMs: report.latencyMs, usage: telemetry?.usage,
      diagnostic: failure?.diagnostic, items: result?.data.items.length,
      economicItems: result?.data.items.filter(item => item.countsTowardDocumentTotal).length,
      groups: result?.consolidationPlan?.groups.length, limitation: result?.qualityLimitation?.diagnostic, reportPath }));
  } finally {
    // Delete only this exact lock after all synchronous accounting attempts.
    // A crash leaves it in place for explicit reconciliation before another call.
    if (!reserved || accountingCompleted) await unlink(lockPath);
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Association replay failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

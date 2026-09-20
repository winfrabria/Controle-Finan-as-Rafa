import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, writeFile, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { OpenRouterInvoiceExtractionClient, OpenRouterClientError } from "../src/server/integrations/openrouter/client";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { planPageWindows, remapWindowEvidence } from "../src/lib/integrations/openrouter/page-windows";

/** Experimental window, NOT a whole-document diagnosis or a production route.
 * One call, no fallback, original identity checked against the isolated note.
 * --prepare creates only a derived PDF for visual inspection; --online validates
 * that derivative again before sending it to the existing provider. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, noteId, firstArgument, lastArgument, selectedModel] = process.argv.slice(2);
  assert(process.argv.slice(2).length <= 5);
  assert(mode === "--prepare" || mode === "--online" || mode === "--plan");
  const first = Number(firstArgument), last = Number(lastArgument);
  const note = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } },
    select: { originalFileName: true, originalFileSha256: true, originalPageCount: true } });
  assert(note.originalPageCount && note.originalFileSha256);
  if (mode === "--plan") {
    console.log(JSON.stringify({ mode, providerCalls: 0, databaseMutations: 0, originalSha256: note.originalFileSha256,
      windows: planPageWindows(note.originalPageCount, 4, 8),
      limitation: "Planning only. No automatic execution, association or whole-document coverage certification." }));
    return;
  }
  assert(Number.isSafeInteger(first) && Number.isSafeInteger(last) && first > 0 && last >= first && last - first < 4 && last <= note.originalPageCount);
  assert(!/[\\/]/.test(note.originalFileName), "Original file name must not contain a path.");
  const originalPath = resolve("G:/Downloads", note.originalFileName);
  assert((await stat(originalPath)).size <= 25 * 1024 * 1024, "Source exceeds probe limit.");
  const original = await readFile(originalPath);
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(original), note.originalFileSha256, "Original differs from the uploaded source.");
  const path = resolve("tmp/pdfs", `window-${noteId}-${first}-${last}.pdf`);
  const manifestPath = `${path}.json`;
  const pages = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  if (mode === "--prepare") {
    const source = await PDFDocument.load(original);
    assert.equal(source.getPageCount(), note.originalPageCount);
    assert.equal(source.getForm().getFields().length, 0, "Interactive forms need separate appearance validation before splitting.");
    const window = await PDFDocument.create();
    for (const page of await window.copyPages(source, pages.map(value => value - 1))) window.addPage(page);
    const bytes = await window.save();
    await writeFile(path, bytes, { flag: "wx" });
    await writeFile(manifestPath, JSON.stringify({ noteId, originalSha256: hash(original), windowSha256: hash(bytes), pages }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ mode, path, pages, providerCalls: 0 }));
    return;
  }
  const bytes = await readFile(path);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.noteId, noteId);
  assert.equal(manifest.originalSha256, hash(original));
  assert.equal(manifest.windowSha256, hash(bytes));
  assert.deepEqual(manifest.pages, pages);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), pages.length);
  const config = getOpenRouterConfig({ ...process.env,
    ...(selectedModel ? { OPENROUTER_PDF_MODEL: selectedModel } : {}),
    OPENROUTER_PDF_ENGINE: "native", OPENROUTER_EXTRACTION_MAX_TOKENS: "16384" }, "extraction");
  const budgetPath = resolve("tmp/budget-new-20260908.json");
  const lockPath = resolve("tmp/consolidation-budget.lock");
  const lock = await open(lockPath, "wx"); await lock.close();
  const reservationUsd = 0.5;
  let reserved = false;
  let knownCost: number | undefined;
  const reportPath = resolve("tmp", `page-window-probe-${randomUUID()}.json`);
  const report: Record<string, unknown> = { scope: "EXPERIMENT_ONLY_NO_DATABASE_MUTATION", noteId,
    originalSha256: hash(original), windowSha256: hash(bytes), originalPages: pages,
    startedAt: new Date().toISOString(), status: "PREPARED", model: config.pdfModel,
    maxTokens: 16384, timeoutMs: 60000, reservationUsd,
    pageNumbering: "Extraction page 1 maps to originalPages[0]; never publish local numbering as original numbering." };
  try {
    const budget = JSON.parse(await readFile(budgetPath, "utf8"));
    const keyResponse = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(5000),
    });
    assert(keyResponse.ok);
    const key = await keyResponse.json();
    assert(typeof key.data?.usage === "number" && Number.isFinite(key.data.usage));
    budget.sharedKeyDeltaObservedUsd = Math.max(budget.sharedKeyDeltaObservedUsd, key.data.usage - budget.keyUsageBaseline, 0);
    budget.sharedKeyObservedAt = new Date().toISOString();
    assert(Math.max(budget.knownCostUsd, budget.sharedKeyDeltaObservedUsd) + budget.reservedUsd + reservationUsd <= budget.authorizedUsd);
    budget.reservedUsd += reservationUsd;
    await writeFile(budgetPath, JSON.stringify(budget, null, 2)); reserved = true;
    report.status = "STARTED";
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: reportPath, status: "STARTED", model: config.pdfModel, pages }));
    const client = new OpenRouterInvoiceExtractionClient({ ...config, maxAttempts: 1, maxTokens: 16384, timeoutMs: 60000, totalTimeoutMs: 60000 });
    const result = await client.extractInvoice({ fileName: "document-window.pdf", mimeType: "application/pdf",
      signedUrl: `data:application/pdf;base64,${bytes.toString("base64")}`, pageCount: pages.length });
    knownCost = result.usage?.costUsd;
    Object.assign(report, { status: "SUCCEEDED", result,
      originalPageEvidence: remapWindowEvidence(result.data, pages, note.originalPageCount) });
    console.log(JSON.stringify({ status: "SUCCEEDED", latencyMs: result.latencyMs, usage: result.usage,
      limitation: result.qualityLimitation, items: result.data.items.map(item => ({ line: item.lineNumber,
        total: item.totalAmount, observations: item.evidenceObservations })), pageCoverage: result.data.pageCoverage }));
  } catch (error) {
    if (error instanceof OpenRouterClientError) knownCost = error.usage?.costUsd;
    Object.assign(report, { status: "FAILED", error: error instanceof OpenRouterClientError ? {
      kind: error.kind, diagnostic: error.diagnostic, latencyMs: error.latencyMs, usage: error.usage,
      attemptTrace: error.attemptTrace, requestId: error.requestId,
    } : { kind: "LOCAL_PROBE_FAILURE" } });
    console.log(JSON.stringify({ status: "FAILED", error: report.error }));
    process.exitCode = 1;
  } finally {
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    if (reserved) {
      const budget = JSON.parse(await readFile(budgetPath, "utf8"));
      if (knownCost !== undefined && Number.isFinite(knownCost) && knownCost >= 0) {
        budget.knownCostUsd += knownCost; budget.reservedUsd -= reservationUsd;
      }
      budget.windowRepairTrials = [...(budget.windowRepairTrials ?? []), { report: reportPath,
        costUsd: knownCost ?? null, retainedReservationUsd: knownCost === undefined ? reservationUsd : 0 }];
      await writeFile(budgetPath, JSON.stringify(budget, null, 2));
    }
    await unlink(lockPath);
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Probe failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { HARNESS_VERSIONS } from "../src/lib/audit-harness/versions";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { OpenRouterClientError, OpenRouterInvoiceExtractionClient } from "../src/server/integrations/openrouter/client";

/** Diagnostic only. Renders a full page from the byte-verified original, then
 * reads it without any prior fields, findings, supplier or expected values.
 * One paid call per fingerprint; no database mutation, fallback or auto-retry. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, noteId, sourcePath, pageArgument, model = "google/gemini-3.7-flash", effort = "low"] = process.argv.slice(2);
  assert(["--prepare", "--plan", "--online"].includes(mode));
  assert(process.argv.slice(2).length >= 4 && process.argv.slice(2).length <= 6);
  assert(["low", "medium", "high"].includes(effort));
  const page = Number(pageArgument);
  const source = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } },
    select: { originalFileSha256: true, originalPageCount: true } });
  assert(Number.isSafeInteger(page) && page >= 1 && page <= (source.originalPageCount ?? 0));
  assert((await stat(sourcePath)).size <= 25 * 1024 * 1024);
  const original = await readFile(sourcePath);
  const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha(original), source.originalFileSha256);
  assert.equal((await PDFDocument.load(original)).getPageCount(), source.originalPageCount);
  const prefix = resolve("tmp/pdfs", `blind-${noteId}-${page}-${sha(original).slice(0, 12)}`);
  const manifestPath = `${prefix}.json`, imagePath = `${prefix}.png`;
  if (mode === "--prepare") {
    const manifest = { state: "PREPARING", noteId, originalSha256: sha(original), page, imagePath, scaleTo: 2400,
      imageSha256: "", preparedAt: new Date().toISOString() };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
    execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2400",
      "-png", resolve(sourcePath), prefix], { timeout: 30000, windowsHide: true, stdio: "pipe" });
    manifest.imageSha256 = sha(await readFile(imagePath)); manifest.state = "PREPARED";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ stage: "PREPARED", manifestPath, imagePath, providerCalls: 0 }));
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.state, "PREPARED"); assert.equal(manifest.noteId, noteId);
  assert.equal(manifest.originalSha256, sha(original)); assert.equal(manifest.page, page);
  const png = await readFile(imagePath);
  assert.equal(sha(png), manifest.imageSha256);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const config = getOpenRouterConfig({ ...process.env, OPENROUTER_EXTRACTION_MODEL: model,
    OPENROUTER_EXTRACTION_REASONING_EFFORT: effort }, "extraction");
  const contract = { originalSha256: sha(original), imageSha256: sha(png), originalPage: page,
    model: config.model, effort, maxTokens: 16384, timeoutMs: 180000, maxAttempts: 1, versions: HARNESS_VERSIONS };
  const fingerprint = sha(JSON.stringify(contract));
  const reportPath = resolve("tmp", `blind-page-${fingerprint}.json`);
  const report: Record<string, unknown> = { scope: "BLIND_PAGE_READING_NO_DB_MUTATION", noteId, ...contract,
    status: "PLANNED", costStatus: "UNKNOWN", reportPath,
    inputPolicy: "IMAGE_ONLY_WITH_GENERIC_EXTRACTION_PROMPT_NO_PRIOR_VALUES_OR_FINDINGS",
    pageNumbering: "Only local page 1 is in scope; it maps to originalPage. This is not whole-document coverage." };
  if (mode === "--plan") { console.log(JSON.stringify(report)); return; }
  report.status = "STARTED"; report.startedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ stage: "STARTED", reportPath, model: config.model, effort }));
  const started = Date.now();
  try {
    const result = await new OpenRouterInvoiceExtractionClient({ ...config, maxAttempts: 1,
      maxTokens: 16384, timeoutMs: 180000, totalTimeoutMs: 180000, extractionQualityGateEnabled: true })
      .extractInvoice({ fileName: "isolated-page.png", mimeType: "image/png", pageCount: 1,
        signedUrl: `data:image/png;base64,${png.toString("base64")}` });
    Object.assign(report, { status: "SUCCEEDED", result, costStatus: result.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN" });
    console.log(JSON.stringify({ stage: "SUCCEEDED", reportPath, usage: result.usage, latencyMs: result.latencyMs }));
  } catch (error) {
    const failure = error instanceof OpenRouterClientError ? error : undefined;
    Object.assign(report, { status: "FAILED", error: failure ? { kind: failure.kind, diagnostic: failure.diagnostic,
      diagnosticDetails: failure.diagnosticDetails, usage: failure.usage, attemptTrace: failure.attemptTrace,
      validatedExtraction: failure.validatedExtraction, requestId: failure.requestId } : { kind: "LOCAL_FAILURE" },
      costStatus: failure?.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN" });
    console.log(JSON.stringify({ stage: "FAILED", reportPath, diagnostic: failure?.diagnostic })); process.exitCode = 1;
  } finally {
    report.endedAt = new Date().toISOString(); report.latencyMs = Date.now() - started;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Blind page probe failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

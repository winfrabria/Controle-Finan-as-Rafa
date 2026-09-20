import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { OpenRouterClientError, OpenRouterInvoiceExtractionClient } from "../src/server/integrations/openrouter/client";
import { HARNESS_VERSIONS } from "../src/lib/audit-harness/versions";

/** One original-PDF read, no fallback, no diagnosis/DB mutation. Durable STARTED
 * report is also the idempotency guard. Unknown cost is never recorded as zero. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, noteId, sourcePath, model, effort = "high"] = process.argv.slice(2);
  assert([4, 5].includes(process.argv.slice(2).length) && ["--plan", "--online"].includes(mode));
  assert(["low", "high"].includes(effort));
  assert(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(noteId));
  assert(sourcePath.toLowerCase().endsWith(".pdf"));
  const note = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } },
    select: { originalFileSha256: true, originalPageCount: true } });
  assert((await stat(sourcePath)).size <= 25 * 1024 * 1024);
  const bytes = await readFile(sourcePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash, note.originalFileSha256);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), note.originalPageCount);
  const config = getOpenRouterConfig({ ...process.env, OPENROUTER_PDF_MODEL: model,
    OPENROUTER_PDF_REASONING_EFFORT: effort, OPENROUTER_PDF_ENGINE: "native",
    OPENROUTER_EXTRACTION_MAX_TOKENS: "32768" }, "extraction");
  const contract = { originalSha256: hash, pageCount: note.originalPageCount, model: config.pdfModel,
    reasoningEffort: config.pdfReasoningEffort, schemaMode: config.schemaMode, versions: HARNESS_VERSIONS,
    maxTokens: 32768, timeoutMs: 120000, maxAttempts: 1 };
  const fingerprint = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
  const reportPath = resolve("tmp", `full-extraction-probe-${fingerprint}.json`);
  const report: Record<string, unknown> = { scope: "ISOLATED_EXTRACTION_ONLY_NO_DB_MUTATION", ...contract,
    noteId, reportPath, providerCalls: mode === "--online" ? 1 : 0 };
  if (mode === "--plan") { console.log(JSON.stringify(report)); return; }
  Object.assign(report, { status: "STARTED", startedAt: new Date().toISOString(), costStatus: "UNKNOWN" });
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "STARTED", reportPath, ...contract }));
  const started = Date.now();
  try {
    const result = await new OpenRouterInvoiceExtractionClient({ ...config, maxAttempts: 1,
      maxTokens: 32768, timeoutMs: 120000, totalTimeoutMs: 120000, extractionQualityGateEnabled: true })
      .extractInvoice({ fileName: "original-document.pdf", mimeType: "application/pdf", pageCount: note.originalPageCount!,
        signedUrl: `data:application/pdf;base64,${bytes.toString("base64")}` });
    Object.assign(report, { status: "SUCCEEDED", result,
      costStatus: result.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN" });
    console.log(JSON.stringify({ status: report.status, latencyMs: result.latencyMs, usage: result.usage,
      items: result.data.items.length, limitation: result.qualityLimitation, reportPath }));
  } catch (error) {
    const failure = error instanceof OpenRouterClientError ? error : undefined;
    Object.assign(report, { status: "FAILED", error: failure ? { kind: failure.kind, diagnostic: failure.diagnostic,
      diagnosticDetails: failure.diagnosticDetails, usage: failure.usage, attemptTrace: failure.attemptTrace,
      requestId: failure.requestId, validatedExtraction: failure.validatedExtraction } : { kind: "LOCAL_FAILURE" },
      costStatus: failure?.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN" });
    console.log(JSON.stringify({ status: report.status, diagnostic: failure?.diagnostic, usage: failure?.usage, reportPath }));
    process.exitCode = 1;
  } finally {
    Object.assign(report, { latencyMs: Date.now() - started, endedAt: new Date().toISOString() });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Probe failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

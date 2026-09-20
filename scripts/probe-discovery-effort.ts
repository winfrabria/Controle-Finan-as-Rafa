import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { evaluateHarness, evaluateUniversalRules, HARNESS_VERSIONS } from "../src/lib/audit-harness";
import { getEvidenceCoverageLimitation } from "../src/lib/integrations/openrouter/evidence-coverage";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { OpenRouterAuditDiscoveryClient } from "../src/server/integrations/openrouter/audit-client";
import { OpenRouterClientError } from "../src/server/integrations/openrouter/client";

/** Explicit single-call experiment; never stores findings or modifies a note. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, noteId, model, effort] = process.argv.slice(2);
  assert(mode === "--online" && process.argv.length === 6);
  assert(["openai/gpt-5.6-terra", "openai/gpt-5.6-sol", "google/gemini-3.8-flash"].includes(model));
  assert(effort === "low" || effort === "medium");
  const note = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } },
    select: { id: true, version: true, extractedData: true, originalFileSha256: true, originalPageCount: true } });
  const parsed = parseInvoiceExtractionPayload(note.extractedData);assert(parsed.success);
  const invoice = { ...parsed.data, originalFileSha256: note.originalFileSha256 };
  const reportPath = resolve("tmp", `discovery-effort-${randomUUID()}.json`);
  const report: Record<string, unknown> = { scope: "ONE_CALL_NO_NOTE_MUTATION", model, effort,
    noteId, noteVersion: note.version, originalFileSha256: note.originalFileSha256, versions: HARNESS_VERSIONS,
    timeoutMs: 60000, maxTokens: 8192, maxAttempts: 1, schemaMode: "shape-only", startedAt: new Date().toISOString() };
  const save = () => writeFile(reportPath, JSON.stringify(report, null, 2));await save();
  console.log(JSON.stringify({ status: "STARTED", report: reportPath }));
  const client = new OpenRouterAuditDiscoveryClient({ ...getOpenRouterConfig(process.env, "audit"), model,
    experimentalReasoningEffort: effort, schemaMode: "shape-only", timeoutMs: 60000, maxTokens: 8192, maxAttempts: 1, webSearchEnabled: false });
  try {
    const result = await client.discover({ invoice, workRules: [], reasoningEffort: "high",
      deterministicFindings: evaluateUniversalRules({ invoice }).findings,
      extractionLimitationSummary: getEvidenceCoverageLimitation(invoice, note.originalPageCount)?.message });
    report.result = result;
    const evaluated = evaluateHarness({ invoice, aiDiscovery: result.data });
    report.evaluation = { classification: evaluated.classification, unconfirmed: evaluated.unconfirmedAiFindings.map(item => item.code) };
    console.log(JSON.stringify({ status: "SUCCEEDED", latencyMs: result.latencyMs, usage: result.usage,
      findings: result.data.findings.map(item => ({ code: item.code, title: item.title })), evaluation: report.evaluation }));
  } catch (error) {
    report.error = error instanceof OpenRouterClientError ? { kind: error.kind, diagnostic: error.diagnostic,
      generationId: error.generationId, usage: error.usage, latencyMs: error.latencyMs, attemptTrace: error.attemptTrace } : { kind: "LOCAL_ERROR" };
    console.log(JSON.stringify({ status: "FAILED", error: report.error }));process.exitCode = 1;
  } finally {
    await save();
    assert.deepEqual(await prisma.note.findUniqueOrThrow({ where: { id: noteId }, select: { version: true, extractedData: true } }),
      { version: note.version, extractedData: note.extractedData });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Discovery trial failed");process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

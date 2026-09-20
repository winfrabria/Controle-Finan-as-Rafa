import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildVerificationChecks, evaluateHarness, HARNESS_VERSIONS, resolveHarnessVerifierReasoningEffort } from "../src/lib/audit-harness";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { prisma } from "../src/server/db/prisma";
import { runSelectiveVerification, type SelectiveVerificationOutput } from "../src/server/notes/run-selective-verification";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { buildVerificationTextPayload, OpenRouterVerificationClient } from "../src/server/integrations/openrouter/verification-client";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { resolveVerificationOutputTokenParameter } from "../src/server/integrations/openrouter/routing";

/** One measured verifier call on an existing immutable local extraction. No re-upload,
 * extraction call, note status change or human acceptance is implied by this probe. */
async function main() {
  assertIsolatedHarnessTargets();
  const args = process.argv.slice(2);
  assert(args.length === 2 && ["--online", "--plan"].includes(args[0]), "Supply --plan or --online and exactly one local note ID.");
  const note = await prisma.note.findFirstOrThrow({ where: { id: args[1], work: { code: "LOCAL-104" } },
    select: { id: true, extractedData: true, originalFileName: true, originalFilePath: true, originalFileSha256: true,
      originalPageCount: true, originalMimeType: true, processingStage: true, version: true } });
  assert.equal(note.processingStage, "COMPLETED", "Do not probe an actively processing note.");
  assert(note.originalFileSha256, "The source must have an immutable file hash.");
  assert(note.originalMimeType === "application/pdf" || note.originalMimeType === "image/png" || note.originalMimeType === "image/jpeg");
  const parsed = parseInvoiceExtractionPayload(note.extractedData);
  assert(parsed.success, "Stored extraction must pass the current schema.");
  const invoice = { ...parsed.data, originalFileSha256: note.originalFileSha256 };
  const base = evaluateHarness({ invoice });
  const expectedChecks = buildVerificationChecks(invoice);
  const initialFindings = [...base.findings, ...base.unconfirmedAiFindings];
  const config = getOpenRouterConfig(process.env, "verification");
  // Probe-only compatibility setting: never read by the application runtime.
  const outputTokenParameter = resolveVerificationOutputTokenParameter(process.env.HARNESS_PROBE_TOKEN_PARAMETER);
  const providerOnly = process.env.HARNESS_PROBE_PROVIDER_ONLY?.split(",").map(value => value.trim());
  const requestConfiguration = { model: config.model, reasoningEffort: config.reasoningEffort,
    pdfEngine: config.pdfEngine, timeoutMs: config.timeoutMs, maxTokens: config.maxTokens,
    outputTokenParameter, providerOnly };
  if (args[0] === "--plan") {
    const payload = buildVerificationTextPayload({ baseClassification: base.classification,
      expectedChecks, expectedPageCount: note.originalPageCount, initialFindings, invoice });
    console.log(JSON.stringify({ scope: "READ_ONLY_WORKLOAD_PLAN_NO_PROVIDER_CALL", versions: HARNESS_VERSIONS,
      noteId: note.id, noteVersion: note.version, pageCount: note.originalPageCount,
      itemCount: invoice.items.length, expectedCheckCount: expectedChecks.length,
      itemSourceObservationCount: invoice.items.reduce((count, item) => count + (item.evidenceObservations?.length ?? 0), 0),
      documentObservationCount: invoice.documentObservations?.length ?? 0,
      candidatePairCount: payload.sourceComparisons.candidates.length,
      textPayloadCharacters: JSON.stringify(payload).length, markdownCharacters: invoice.markdown.length,
      model: config.model, reasoningEffort: config.reasoningEffort, pdfEngine: config.pdfEngine,
      timeoutMs: config.timeoutMs, maxTokens: config.maxTokens,
      outputTokenParameter,
      providerOnly,
      limitations: ["Character counts are not token counts or latency estimates.",
        "The original PDF, system prompt and output schema are additional model input.",
        "Initial findings here come from the local rules, not a new AI audit."] }));
    return;
  }
  const startedAt = Date.now();
  const path = resolve("tmp", `verification-probe-${randomUUID()}.json`);
  await mkdir(resolve("tmp"), { recursive: true });
  const report: Record<string, unknown> = { scope: "VERIFIER_ONLY_NO_DIAGNOSIS_CHANGE", versions: HARNESS_VERSIONS,
    noteId: note.id, noteVersion: note.version, originalFileSha256: note.originalFileSha256, requestConfiguration };
  await writeFile(path, JSON.stringify(report, null, 2));
  let result: SelectiveVerificationOutput | undefined;
  try {
    result = await runSelectiveVerification({ baseClassification: base.classification,
      initialFindings, invoice,
      expectedChecks, expectedPageCount: note.originalPageCount,
      fileName: note.originalFileName, filePath: note.originalFilePath, mimeType: note.originalMimeType,
      noteId: note.id, originalFileSha256: note.originalFileSha256 },
      { client: new OpenRouterVerificationClient({ ...config, outputTokenParameter, providerOnly,
        reasoningEffort: resolveHarnessVerifierReasoningEffort(config.reasoningEffort) }) });
    report.result = result;
  } catch (error) {
    report.error = { name: error instanceof Error ? error.name : "ProbeError",
      code: error && typeof error === "object" && "code" in error ? error.code : null };
    process.exitCode = 1;
  } finally {
    const run = await prisma.aiRun.findFirst({ where: result ? { id: result.runId } : {
      noteId: note.id, kind: "VERIFICATION", policyVersion: HARNESS_VERSIONS.policy, createdAt: { gte: new Date(startedAt) } },
      orderBy: { createdAt: "desc" }, select: { id: true, status: true, latencyMs: true, costUsd: true, model: true,
        promptTokens: true, completionTokens: true, structuredResponse: true } });
    const metadata = run?.structuredResponse as Record<string, unknown> | null;
    report.run = run; report.totalMs = Date.now() - startedAt;
    report.noteUnchanged = (await prisma.note.findUniqueOrThrow({ where: { id: note.id }, select: { version: true } })).version === note.version;
    await writeFile(path, JSON.stringify(report, null, 2));
    assert.equal(report.noteUnchanged, true);
    console.log(JSON.stringify({ report: path, requestConfiguration, error: report.error ?? null, latencyMs: run?.latencyMs, costUsd: run?.costUsd,
      hasGenerationId: Boolean(metadata?.generationId), transport: metadata?.transport ?? null,
      responseStatus: result?.data.status, coverageComplete: result?.coverage.complete,
      findings: result?.data.findings.map(finding => finding.code), reused: result?.reused, noteUnchanged: true }));
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verifier probe failed."); process.exitCode = 1;
}).finally(() => prisma.$disconnect());

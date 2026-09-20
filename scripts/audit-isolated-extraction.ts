import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildVerificationChecks, evaluateHarness, evaluateUniversalRules, HARNESS_VERSIONS } from "../src/lib/audit-harness";
import { buildSourceComparisons, compactVerificationInvoice } from "../src/lib/audit-harness/source-comparisons";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { getOpenRouterAuditDiscoveryClient, OpenRouterAuditDiscoveryClient } from "../src/server/integrations/openrouter/audit-client";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { OpenRouterClientError } from "../src/server/integrations/openrouter/client";
import { prisma } from "../src/server/db/prisma";
import { runSelectiveVerification } from "../src/server/notes/run-selective-verification";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";

/** Diagnose the audit/verifier against an existing local read, without buying
 * another extraction or altering the note's findings, version or classification. */
async function main() {
  assertIsolatedHarnessTargets();
  const args = process.argv.slice(2);
  assert(args.length === 2 && ["--online", "--plan", "--discovery-only"].includes(args[0]), "Supply --plan, --online or --discovery-only and one local note ID.");
  const discoveryOnly = args[0] === "--discovery-only";
  const note = await prisma.note.findFirstOrThrow({ where: { id: args[1], work: { code: "LOCAL-104" } },
    select: { id: true, extractedData: true, originalFileName: true, originalFilePath: true, originalFileSha256: true,
      originalPageCount: true, originalMimeType: true, processingStage: true, version: true } });
  assert.equal(note.processingStage, "COMPLETED"); assert(note.originalFileSha256);
  assert(note.originalMimeType === "application/pdf" || note.originalMimeType === "image/png" || note.originalMimeType === "image/jpeg");
  const parsed = parseInvoiceExtractionPayload(note.extractedData); assert(parsed.success);
  const invoice = { ...parsed.data, originalFileSha256: note.originalFileSha256 };
  const requestSummary = { sourceComparisons: buildSourceComparisons(invoice),
    canonicalInvoiceCharacters: JSON.stringify(invoice).length,
    transportInvoiceCharacters: JSON.stringify(compactVerificationInvoice(invoice)).length };
  if (args[0] === "--plan") {
    console.log(JSON.stringify({ scope: "READ_ONLY_NO_PROVIDER_CALLS", noteId: note.id, ...requestSummary }));
    return;
  }
  const path = resolve("tmp", `audit-probe-${randomUUID()}.json`);
  await mkdir(resolve("tmp"), { recursive: true });
  const report: Record<string, unknown> = { scope: discoveryOnly ? "DISCOVERY_ONLY_ONE_CALL_NO_DIAGNOSIS_CHANGE" : "AUDIT_AND_VERIFIER_ONLY_NO_DIAGNOSIS_CHANGE", noteId: note.id,
    versions: HARNESS_VERSIONS, noteVersion: note.version, originalFileSha256: note.originalFileSha256, ...requestSummary };
  const save = () => writeFile(path, JSON.stringify(report, null, 2));
  await save();
  try {
    const client = discoveryOnly ? new OpenRouterAuditDiscoveryClient({ ...getOpenRouterConfig(process.env, "audit"),
      maxAttempts: 1, timeoutMs: 30_000, webSearchEnabled: false }) : getOpenRouterAuditDiscoveryClient();
    const audit = await client.discover({ invoice, workRules: [],
      deterministicFindings: evaluateUniversalRules({ invoice }).findings, reasoningEffort: "high" });
    report.audit = audit; await save();
    const base = evaluateHarness({ invoice, aiDiscovery: audit.data });
    console.log(JSON.stringify({ stage: "AUDIT_PROBE", findings: audit.data.findings.map(finding => finding.code),
      unconfirmed: base.unconfirmedAiFindings.map(finding => finding.code), latencyMs: audit.latencyMs, usage: audit.usage }));
    if (discoveryOnly) return;
    report.verification = await runSelectiveVerification({ baseClassification: base.classification,
      initialFindings: [...base.findings, ...base.unconfirmedAiFindings], invoice,
      expectedChecks: buildVerificationChecks(invoice), expectedPageCount: note.originalPageCount,
      fileName: note.originalFileName, filePath: note.originalFilePath, mimeType: note.originalMimeType,
      noteId: note.id, originalFileSha256: note.originalFileSha256 });
  } catch (error) {
    report.error = { name: error instanceof Error ? error.name : "ProbeError",
      code: error && typeof error === "object" && "code" in error ? error.code : null,
      ...(error instanceof OpenRouterClientError ? { kind: error.kind, diagnostic: error.diagnostic,
        attempts: error.attempts, attemptTrace: error.attemptTrace, latencyMs: error.latencyMs,
        model: error.model, provider: error.provider, requestId: error.requestId, usage: error.usage,
        costStatus: error.usage?.costUsd === undefined ? "UNKNOWN" : "KNOWN" } : {}) };
    process.exitCode = 1;
  } finally {
    const current = await prisma.note.findUniqueOrThrow({ where: { id: note.id }, select: { version: true } });
    report.noteUnchanged = current.version === note.version;
    await save(); assert.equal(current.version, note.version, "The probe must not alter the note version.");
    console.log(JSON.stringify({ report: path, noteUnchanged: report.noteUnchanged, error: report.error ?? null }));
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Audit probe failed."); process.exitCode = 1;
}).finally(() => prisma.$disconnect());

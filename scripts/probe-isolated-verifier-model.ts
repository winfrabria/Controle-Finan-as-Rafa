import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { createInvoiceSignedUrl } from "../src/server/storage";
import { resolveAiDocumentSource } from "../src/server/storage/ai-document-source";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { buildVerificationChecks, evaluateHarness, validateVerificationCoverage, aiDiscoveryResponseSchema, HARNESS_VERSIONS } from "../src/lib/audit-harness";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";
import { OpenRouterVerificationClient } from "../src/server/integrations/openrouter/verification-client";
import { OpenRouterClientError } from "../src/server/integrations/openrouter/client";
import { readOpenRouterCompletionStream, type CompletionTransport } from "../src/server/integrations/openrouter/completion-stream";
import { getOpenRouterProviderRouting } from "../src/server/integrations/openrouter/routing";

/** One independent original-document trial. Never changes the runtime model or a diagnosis. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, noteId, selectedModel = "google/gemini-3.8-flash", effort = "high", discoveryId] = process.argv.slice(2);
  assert(["--online", "--transport-only", "--shape-only", "--with-discovery", "--full-document"].includes(mode));
  assert(noteId && process.argv.slice(2).length <= (mode === "--with-discovery" ? 5 : 4));
  assert(effort === "low" || effort === "medium" || effort === "high");
  assert(["google/gemini-3.7-flash", "google/gemini-3.8-flash"].includes(selectedModel));
  const note = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } } });
  assert.equal(note.processingStage, "COMPLETED");
  assert.equal(note.originalMimeType, "application/pdf");
  const parsed = parseInvoiceExtractionPayload(note.extractedData);
  assert(parsed.success);
  const signed = await createInvoiceSignedUrl({ path: note.originalFilePath });
  const source = await resolveAiDocumentSource({ signedUrl: signed.signedUrl, path: note.originalFilePath,
    mimeType: note.originalMimeType, fileName: note.originalFileName });
  assert(source.startsWith("data:application/pdf;base64,"));
  assert.equal(createHash("sha256").update(Buffer.from(source.split(",")[1], "base64")).digest("hex"), note.originalFileSha256);
  const invoice = { ...parsed.data, originalFileSha256: note.originalFileSha256 };
  let discovery;
  if (mode === "--with-discovery") {
    assert(discoveryId && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(discoveryId));
    const saved = JSON.parse(await readFile(resolve("tmp", `discovery-effort-${discoveryId}.json`), "utf8"));
    assert.equal(saved.noteId, note.id);assert.equal(saved.noteVersion, note.version);
    assert.equal(saved.originalFileSha256, note.originalFileSha256);assert.deepEqual(saved.versions, HARNESS_VERSIONS);
    discovery = aiDiscoveryResponseSchema.parse(saved.result.data);
  }
  const base = evaluateHarness({ invoice, aiDiscovery: discovery });
  const initialFindings = [...base.findings, ...base.unconfirmedAiFindings];
  const expectedChecks = buildVerificationChecks(invoice, initialFindings);
  const config = getOpenRouterConfig(process.env, "verification");
  const options = { ...config, model: selectedModel, reasoningEffort: effort as "low" | "medium" | "high",
    timeoutMs: 45_000, outputTokenParameter: "max_tokens" as const, pdfEngine: "native" };
  const shapeOnly = mode === "--shape-only" || mode === "--with-discovery" || mode === "--full-document";
  if (shapeOnly) {
    const larger = mode === "--with-discovery" || mode === "--full-document";
    assert(note.originalPageCount !== null && note.originalPageCount <= (larger ? 32 : 5));
    assert(source.length <= (larger ? 15_000_000 : 2_000_000));
    assert(expectedChecks.length <= (larger ? 128 : 25));
    options.maxTokens = larger ? config.maxTokens : 8192;
    options.timeoutMs = larger ? 180_000 : 60_000;
  }
  // A smaller, bounded five-page/25-check/8192-output trial reserves USD0.50.
  // Never release earlier unknown-cost reservations to make this trial fit.
  const reservationUsd = mode === "--with-discovery" || mode === "--full-document" ? 1 : shapeOnly ? 0.5 : 1;
  const budgetPath = resolve("tmp/budget-new-20260908.json");
  const lockPath = resolve("tmp/consolidation-budget.lock");
  const lock = await open(lockPath, "wx");
  await lock.close();
  const reportPath = resolve("tmp", `verifier-model-${randomUUID()}.json`);
  let reserved = false;
  const startedAt = Date.now();
  const report: Record<string, unknown> = { scope: "ORIGINAL_PDF_VERIFIER_TRIAL_NO_DIAGNOSIS_CHANGE",
    model: options.model, reasoningEffort: options.reasoningEffort, versions: HARNESS_VERSIONS,
    noteId, noteVersion: note.version, originalFileSha256: note.originalFileSha256,
    expectedCheckCount: expectedChecks.length, pageCount: note.originalPageCount };
  report.discoveryId = discoveryId ?? null;
  report.schemaMode = shapeOnly ? "shape-only" : "bounded";
  report.maxTokens = options.maxTokens; report.timeoutMs = options.timeoutMs; report.reservationUsd = reservationUsd;
  if (mode === "--transport-only") {
    report.scope = "MINIMAL_PDF_TRANSPORT_ONLY_NOT_AN_AUDIT";
    report.reasoningEffort = "low";
    report.expectedCheckCount = 0;
  }
  let cost: number | undefined;
  try {
    const budget = JSON.parse(await readFile(budgetPath, "utf8"));
    // Refresh the shared-key upper-bound observation before reserving. A stale
    // observation must not be used to authorize another paid request.
    const keyResponse = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(5000),
    });
    assert(keyResponse.ok, "Cannot refresh budget observation.");
    const keyMetadata = await keyResponse.json();
    assert(typeof keyMetadata.data?.usage === "number" && Number.isFinite(keyMetadata.data.usage));
    budget.sharedKeyDeltaObservedUsd = Math.max(budget.sharedKeyDeltaObservedUsd,
      keyMetadata.data.usage - budget.keyUsageBaseline, 0);
    budget.sharedKeyObservedAt = new Date().toISOString();
    if (budget.currentAuthorization?.ceilingRemovedByUser !== true) {
      assert(Math.max(budget.knownCostUsd, budget.sharedKeyDeltaObservedUsd) + budget.reservedUsd + reservationUsd <= budget.authorizedUsd);
    }
    budget.reservedUsd += reservationUsd;
    budget.reservationNote = "One Gemini verifier trial reserved; prior unknown-call reservations retained.";
    await writeFile(budgetPath, JSON.stringify(budget, null, 2)); reserved = true;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    if (mode === "--transport-only") {
      // Same immutable PDF and privacy policy; deliberately no audit workload.
      // A response proves transport only, not that the quoted fact is correct.
      const transport: CompletionTransport = { mode: "UNKNOWN", events: 0, contentCharacters: 0, responseComplete: false };
      report.transport = transport;
      const signal = AbortSignal.timeout(30_000);
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, stream: true, max_tokens: 512,
          reasoning: { effort: "low", exclude: true }, provider: getOpenRouterProviderRouting(),
          plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
          messages: [{ role: "user", content: [
            { type: "text", text: "Leia somente a primeira página deste PDF. Responda JSON com page=1 e quote contendo uma frase curta que esteja impressa nessa página. Se não conseguir ler, quote deve ser vazio. Não faça auditoria ou explicações." },
            { type: "file", file: { filename: note.originalFileName, file_data: source } },
          ] }], response_format: { type: "json_schema", json_schema: { name: "pdf_transport_probe", strict: true,
            schema: { type: "object", additionalProperties: false, required: ["page", "quote"],
              properties: { page: { type: "integer" }, quote: { type: "string" } } } } },
        }),
      });
      report.httpStatus = response.status;
      report.headersMs = Date.now() - startedAt;
      report.requestId = response.headers.get("x-request-id") ?? response.headers.get("x-openrouter-request-id");
      assert(response.ok, "Transport HTTP response unsuccessful");
      const body = response.headers.get("content-type")?.includes("text/event-stream")
        ? await readOpenRouterCompletionStream(response, { signal, startedAt, transport, onMetadata: metadata => {
          report.generationId = metadata.id; cost = metadata.usage?.cost ?? cost;
        } }) : await response.json();
      cost = body.usage?.cost ?? cost;
      const answer = JSON.parse(body.choices[0].message.content);
      assert(answer.page === 1 && typeof answer.quote === "string" && answer.quote.length <= 2000);
      report.answer = answer;
      report.responseComplete = true;
      return;
    }
    const result = await new OpenRouterVerificationClient({ ...options,
      schemaMode: shapeOnly ? "shape-only" : "bounded" }).verify({ baseClassification: base.classification,
      expectedChecks, expectedPageCount: note.originalPageCount, initialFindings, invoice,
      fileName: note.originalFileName, mimeType: "application/pdf", signedUrl: source });
    cost = result.usage?.costUsd;
    report.result = result;
    report.coverage = validateVerificationCoverage({ expectedChecks, expectedPageCount: note.originalPageCount,
      initialFindings, response: result.data });
  } catch (error) {
    if (error instanceof OpenRouterClientError) {
      cost = error.usage?.costUsd;
      report.error = { kind: error.kind, generationId: error.generationId, usage: error.usage,
        requestId: error.requestId, diagnostic: error.diagnostic, transport: error.diagnosticDetails?.transport };
    } else {
      report.error = { name: error instanceof Error ? error.name : "Unknown" };
    }
    process.exitCode = 1;
  } finally {
    report.latencyMs = Date.now() - startedAt;
    report.costUsd = cost ?? null;
    report.noteUnchanged = (await prisma.note.findUniqueOrThrow({ where: { id: noteId }, select: { version: true } })).version === note.version;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    if (reserved) {
      const budget = JSON.parse(await readFile(budgetPath, "utf8"));
      if (cost !== undefined) { budget.knownCostUsd += cost; budget.reservedUsd -= reservationUsd; }
      budget.verifierModelTrials = [...(budget.verifierModelTrials ?? []), { report: reportPath, costUsd: cost ?? null,
        retainedReservationUsd: cost === undefined ? reservationUsd : 0 }];
      budget.reservationNote = "No active verifier trial; unknown costs remain reserved. See verifierModelTrials.";
      await writeFile(budgetPath, JSON.stringify(budget, null, 2));
    }
    await unlink(lockPath);
    console.log(JSON.stringify({ report: reportPath, latencyMs: report.latencyMs, costUsd: cost ?? null,
      coverage: report.coverage, error: report.error, noteUnchanged: report.noteUnchanged }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.name : "Probe failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

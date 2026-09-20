import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/server/db/prisma";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";
import { removeInvoiceFile, uploadInvoiceFile } from "@/server/storage";
import { processNoteExtraction } from "@/server/notes/process-note-extraction";
import { processNoteAudit } from "@/server/notes/process-note-audit";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { requiresSourceReview } from "@/lib/audit-harness/source-review";
import { WindowedExtractionClient } from "@/server/integrations/openrouter/windowed-extraction";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

function extraction() {
  return invoiceExtractionSchema.parse({
    documentKind: "FISCAL_INVOICE", documentNumber: "SYNTHETIC-CHECKPOINT",
    supplierName: "Fornecedor de teste", totalAmount: "30.00", markdown: "Fonte de teste, não é uma nota real.",
    readConfidence: 0.99, items: [{ lineNumber: 1, description: "Material de teste", quantity: "1",
      unitPrice: "30.00", totalAmount: "30.00", sourcePage: 1, sourceText: "Material 1 x 30,00 = 30,00", countsTowardDocumentTotal: true }],
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [], evidence: "Linha sintética completa." },
  });
}

for (const consolidationFails of [false, true]) test(`rota de upload visual persiste blocos e ${consolidationFails ? "preserva após falha" : "conclui extração"}`, { skip: !enabled }, async () => {
  const previous = process.env.OPENROUTER_PDF_VISUAL_WINDOWS;
  process.env.OPENROUTER_PDF_VISUAL_WINDOWS = "true";
  const noteId = randomUUID();
  const work = await prisma.work.create({ data: { code: `VISUAL-${noteId}`, name: "Synthetic visual pipeline" } });
  let path: string | undefined, calls = 0;
  try {
    const pdf = await PDFDocument.create();
    for (let page = 0; page < 5; page++) pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    path = (await uploadInvoiceFile({ bytes, contentType: "application/pdf", fileName: "synthetic-visual.pdf", noteId, workId: work.id })).path;
    await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-visual.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(bytes.length), originalPageCount: 5,
      originalFileSha256: createHash("sha256").update(bytes).digest("hex"), publicProtocol: `TEST-VISUAL-${noteId}`,
      publicTokenHash: "b".repeat(64), publicTokenExpiresAt: new Date(0) } });
    const operation = processNoteExtraction(noteId, { windowClientFactory: options => new WindowedExtractionClient({ ...options,
      renderPages: async (_bytes, pages) => pages.map(() => "synthetic-image"),
      createClient: () => ({ extractInvoice: async request => {
        calls++;
        if (request.visualWindows && consolidationFails) throw new Error("Synthetic consolidation failure");
        const data = extraction();
        if (request.visualWindows) data.items = request.visualWindows.flatMap(window => window.data.items).map((item, index) => ({ ...item, lineNumber: index + 1 }));
        else assert.equal(request.pageImages?.length, request.pageCount);
        return { data, attempts: 1, model: options.config.pdfModel!, latencyMs: 1, usage: { costUsd: 0 },
          attemptTrace: [{ attempt: 1, kind: "success", model: options.config.pdfModel!, latencyMs: 1, costStatus: "KNOWN", usage: { costUsd: 0 } }] };
      } }),
    }) });
    if (consolidationFails) await assert.rejects(operation); else await operation;
    assert.equal(calls, 3);
    const events = await prisma.noteEvent.findMany({ where: { noteId, type: "EXTRACTION_WINDOW_CHECKPOINT" } });
    const checkpoints = events.map(event => event.data as Record<string, unknown>).filter(event => event.checkpoint);
    assert.equal(checkpoints.length, 2);
    assert.deepEqual(checkpoints.map(event => event.pages).sort((a, b) => String(a).localeCompare(String(b))), [[1, 2, 3, 4], [5]]);
    const run = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "EXTRACTION" } });
    assert.equal(run.status, consolidationFails ? "FAILED" : "SUCCEEDED");
    if (!consolidationFails) assert.equal(await prisma.noteItem.count({ where: { noteId } }), 2);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_PDF_VISUAL_WINDOWS; else process.env.OPENROUTER_PDF_VISUAL_WINDOWS = previous;
    await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
    if (path) await removeInvoiceFile(path);
  }
});

test("PDF longo persiste modelo, esforço e fingerprint do perfil efetivamente selecionado", { skip: !enabled }, async () => {
  const keys = ["OPENROUTER_EXTRACTION_PIPELINE", "OPENROUTER_LARGE_PDF_READER", "OPENROUTER_PDF_REASONING_EFFORT"] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.OPENROUTER_EXTRACTION_PIPELINE = "adaptive";
  process.env.OPENROUTER_LARGE_PDF_READER = "gemini-3.7-low";
  process.env.OPENROUTER_PDF_REASONING_EFFORT = "high";
  const noteId = randomUUID();
  const work = await prisma.work.create({ data: { code: `READER-${noteId}`, name: "Synthetic reader profile" } });
  let path: string | undefined, calls = 0;
  try {
    const pdf = await PDFDocument.create();
    for (let page = 1; page <= 10; page++) pdf.addPage().drawText(`Synthetic page ${page}`);
    const bytes = Buffer.from(await pdf.save());
    path = (await uploadInvoiceFile({ bytes, contentType: "application/pdf", fileName: "synthetic-reader.pdf", noteId, workId: work.id })).path;
    await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-reader.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(bytes.length), originalPageCount: 10,
      originalFileSha256: createHash("sha256").update(bytes).digest("hex"), publicProtocol: `TEST-READER-${noteId}`,
      publicTokenHash: "c".repeat(64), publicTokenExpiresAt: new Date(0) } });
    await processNoteExtraction(noteId, { client: { extractInvoice: async request => {
      calls++; assert.equal(request.pageCount, 10);
      const running = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "EXTRACTION", status: "RUNNING" } });
      assert.equal(running.model, "google/gemini-3.7-flash");
      assert.equal((running.structuredResponse as Record<string, unknown>).extractionReasoningEffort, "low");
      return { data: extraction(), attempts: 1, model: "google/gemini-3.7-flash", latencyMs: 1,
        usage: { costUsd: 0 }, qualityLimitation: { diagnostic: "synthetic-partial", details: {}, message: "Synthetic partial read." } };
    } } });
    const run = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "EXTRACTION" } });
    assert.equal(calls, 1); assert.equal(run.status, "SUCCEEDED");
    assert.equal((run.structuredResponse as Record<string, unknown>).extractionReasoningEffort, "low");
    assert.equal((run.structuredResponse as Record<string, unknown>).extractionQuality, "EXTRACTION_INCOMPLETE");
    assert.match(run.requestFingerprint!, /^[a-f0-9]{64}$/);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
    if (path) await removeInvoiceFile(path);
  }
});

test("rollback PostgreSQL preserva checkpoint e custo; retomada não chama novamente o provedor", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const noteId = randomUUID();
  const functionName = `harness_checkpoint_${suffix}`;
  const work = await prisma.work.create({ data: { code: `CHECKPOINT-${suffix}`, name: "Synthetic persistence rollback" } });
  let path: string | undefined;
  let calls = 0;
  // Fault injection affects ONLY this test-owned note on the isolated database.
  const dropFault = async () => {
    // DDL takes a table lock even for a note-scoped trigger. Concurrent integration
    // transactions can deadlock during cleanup; retry only that PostgreSQL code.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${functionName} ON public.note_items`);
          await tx.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${functionName}()`);
        });
        break;
      } catch (error) {
        const code = (error as { meta?: { code?: string } }).meta?.code;
        if (code !== "40P01" || attempt >= 2) throw error;
      }
    }
  };
  try {
    const bytes = await readFile("public/brand/favicon-32.png");
    const uploaded = await uploadInvoiceFile({ bytes, contentType: "image/png", fileName: "synthetic-checkpoint.png", noteId, workId: work.id });
    path = uploaded.path;
    await prisma.note.create({ data: {
      id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-checkpoint.png",
      originalMimeType: "image/png", originalSizeBytes: BigInt(bytes.length),
      originalFileSha256: createHash("sha256").update(bytes).digest("hex"), originalPageCount: 1,
      publicProtocol: `TEST-CHECKPOINT-${suffix}`, publicTokenHash: "a".repeat(64), publicTokenExpiresAt: new Date(0),
    } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.note_id = '${noteId}'::uuid THEN RAISE EXCEPTION 'Synthetic persistence failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON public.note_items FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
    const client = { extractInvoice: async () => {
      calls += 1;
      return { data: extraction(), model: "synthetic/offline", provider: "synthetic", attempts: 1, latencyMs: 1,
        usage: { costUsd: 0.05, promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        attemptTrace: [{ attempt: 1, model: "synthetic/offline", kind: "success" as const, latencyMs: 1,
          costStatus: "KNOWN" as const, usage: { costUsd: 0.05 } }] };
    } };
    await assert.rejects(processNoteExtraction(noteId, { client }), { code: "EXTRACTION_PERSISTENCE_FAILED" });
    assert.equal(calls, 1);
    const failed = await prisma.note.findUniqueOrThrow({ where: { id: noteId }, include: { items: true, aiRuns: true } });
    // The stage remains claimable for the durable job's retry; the paid run is terminal.
    assert.equal(failed.processingStage, "EXTRACTING");
    assert.equal(failed.failureCode, "EXTRACTION_PERSISTENCE_FAILED");
    assert.equal(failed.extractedData, null);
    assert.equal(failed.items.length, 0);
    assert.equal(failed.aiRuns.length, 1);
    assert.equal(failed.aiRuns[0].status, "FAILED");
    assert.equal(failed.aiRuns[0].costUsd?.toNumber(), 0.05);
    assert.ok((failed.aiRuns[0].structuredResponse as Record<string, unknown>).checkpoint);
    await dropFault();
    const recovered = await processNoteExtraction(noteId, { client });
    assert.equal(recovered.processingStage, "ANALYZING");
    assert.equal(calls, 1);
    const runs = await prisma.aiRun.findMany({ where: { noteId }, orderBy: { createdAt: "asc" } });
    assert.equal(runs.length, 2);
    assert.equal(runs[1].status, "SUCCEEDED");
    assert.equal(runs[1].attempts, 0);
    assert.equal(runs[1].costUsd?.toNumber(), 0);
    assert.equal((runs[1].structuredResponse as Record<string, unknown>).reusedFromRunId, runs[0].id);
    assert.equal(await prisma.noteItem.count({ where: { noteId } }), 1);
  } finally {
    try {
      await dropFault();
    } finally {
      await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
      await prisma.work.delete({ where: { id: work.id } });
      if (path) await removeInvoiceFile(path);
    }
  }
});

test("modo local persiste apontamento provisório sem suspeita, contexto público ou chamada paga", { skip: !enabled }, async () => {
  const previousMode = process.env.HARNESS_VERIFIER_MODE;
  process.env.HARNESS_VERIFIER_MODE = "off";
  const suffix = randomUUID();
  const work = await prisma.work.create({ data: { code: `PROVISIONAL-${suffix}`, name: "Synthetic provisional evidence" } });
  try {
    const invoice = extraction();
    invoice.totalAmount = "35.00";
    const note = await prisma.note.create({ data: {
      workId: work.id, originalFilePath: "synthetic/provisional.pdf", originalFileName: "synthetic-provisional.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(1), originalPageCount: 3,
      publicProtocol: `TEST-PROVISIONAL-${suffix}`, publicTokenHash: "b".repeat(64), publicTokenExpiresAt: new Date(0),
      status: "PROCESSING", processingStage: "ANALYZING", extractedData: invoice,
    } });
    let calls = 0;
    await processNoteAudit(note.id, {
      client: { discover: async () => { calls += 1; throw new Error("No paid audit permitted in this integration test."); } },
      verificationClient: { verify: async () => { calls += 1; throw new Error("No paid verification permitted in this integration test."); } },
    });
    const result = await prisma.note.findUniqueOrThrow({ where: { id: note.id }, include: { findings: true, contextQuestions: true, aiRuns: true } });
    assert.equal(calls, 0);
    assert.equal(result.auditResult, "READ_FAILED");
    assert.equal(result.status, "READ_FAILED");
    assert.equal(result.classification, "NO_PARAMETER");
    assert.equal(result.processingStage, "COMPLETED");
    assert.equal(result.failureCode, "AUDIT_INSUFFICIENT_COVERAGE");
    assert.equal(result.assuranceBand, "LIMITED");
    assert.equal(result.contextQuestions.length, 0);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].needsValidation, true);
    assert.equal(requiresSourceReview(result.findings[0].evidence), true);
    assert.equal(await prisma.notification.count({ where: { noteId: note.id } }), 0);
    assert.equal(result.aiRuns[0].model, "local/deterministic");
  } finally {
    if (previousMode === undefined) delete process.env.HARNESS_VERIFIER_MODE;
    else process.env.HARNESS_VERIFIER_MODE = previousMode;
    await prisma.note.deleteMany({ where: { workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
  }
});

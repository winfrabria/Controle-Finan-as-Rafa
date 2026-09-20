import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildVerificationChecks } from "@/lib/audit-harness";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import { OpenRouterClientError } from "@/server/integrations/openrouter/client";
import { runSelectiveVerification } from "@/server/notes/run-selective-verification";
import { removeInvoiceFile, uploadInvoiceFile } from "@/server/storage";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

for (const failureKind of ["timeout", "provider", "endpoint", "schema"] as const) {
test(`${failureKind} de stream persiste geração e alcance parcial, sem zerar custo nem repetir chamada`, { skip: !enabled }, async () => {
  const suffix = randomUUID(); const noteId = randomUUID();
  const work = await prisma.work.create({ data: { code: `STREAM-${suffix}`, name: "Synthetic stream persistence" } });
  let path: string | undefined; let calls = 0;
  try {
    const bytes = await readFile("public/brand/favicon-32.png");
    const hash = createHash("sha256").update(bytes).digest("hex");
    path = (await uploadInvoiceFile({ bytes, contentType: "image/png", fileName: "synthetic-stream.png", noteId, workId: work.id })).path;
    await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-stream.png",
      originalMimeType: "image/png", originalSizeBytes: BigInt(bytes.length), originalFileSha256: hash, originalPageCount: 1,
      publicProtocol: `TEST-STREAM-${suffix}`, publicTokenHash: "c".repeat(64), publicTokenExpiresAt: new Date(0) } });
    const invoice = invoiceExtractionSchema.parse({ documentKind: "FISCAL_INVOICE", documentNumber: "SYNTHETIC-STREAM",
      markdown: "Documento sintético de teste de persistência, não é uma despesa real.", readConfidence: 0.99, totalAmount: "10.00", items: [] });
    const input = { baseClassification: "OK" as const, expectedChecks: buildVerificationChecks(invoice), expectedPageCount: 1,
      fileName: "synthetic-stream.png", filePath: path, initialFindings: [], invoice,
      mimeType: "image/png" as const, noteId, originalFileSha256: hash };
    const client = { verify: async () => {
      calls += 1;
      throw new OpenRouterClientError(failureKind === "timeout" ? "timeout" : failureKind === "schema" ? "invalid-response" : "provider", "Synthetic stream failure", false,
        failureKind === "endpoint" ? 404 : undefined, undefined, {
        generationId: "gen-synthetic-persistence", requestId: "req-synthetic-persistence", provider: "synthetic", latencyMs: 30,
        cause: new Error("PRIVATE_PARTIAL_MUST_NOT_BE_STORED"), diagnostic: failureKind === "timeout" ? "verification-deadline-exceeded"
          : failureKind === "endpoint" ? "provider-endpoint-unavailable" : failureKind === "schema" ? "verification-schema-invalid" : "stream-provider-error",
        diagnosticDetails: { schema: failureKind === "schema" ? { issueCount: 1, issues: [{ code: "invalid_type", path: ["checks", 0, "comparison"] }] } : undefined,
          transport: { mode: "SSE", events: 1, contentCharacters: 15, firstEventMs: 2, responseComplete: false,
          ...(failureKind === "provider" ? { providerErrorCode: 503 } : {}) } },
      });
    } };
    await assert.rejects(runSelectiveVerification(input, { client }), { code: failureKind === "timeout" ? "VERIFICATION_TIMEOUT"
      : failureKind === "endpoint" ? "VERIFICATION_ENDPOINT_UNAVAILABLE" : failureKind === "schema" ? "VERIFICATION_INVALID_RESPONSE" : "VERIFICATION_PROVIDER_ERROR" });
    const run = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "VERIFICATION" } });
    const stored = run.structuredResponse as Record<string, unknown>;
    assert.equal(run.status, "FAILED"); assert.equal(run.costUsd, null); assert.equal(run.latencyMs, 30);
    assert.equal(stored.costStatus, "UNKNOWN"); assert.equal(stored.generationId, "gen-synthetic-persistence");
    assert.equal(stored.requestId, "req-synthetic-persistence");
    assert.deepEqual(stored.schema, failureKind === "schema" ? { issueCount: 1, issues: [{ code: "invalid_type", path: ["checks", 0, "comparison"] }] } : null);
    assert.equal(stored.httpStatus, failureKind === "endpoint" ? 404 : null);
    assert.deepEqual(stored.transport, { mode: "SSE", events: 1, contentCharacters: 15, firstEventMs: 2, responseComplete: false,
      ...(failureKind === "provider" ? { providerErrorCode: 503 } : {}) });
    assert.equal(JSON.stringify(stored).includes("PRIVATE_PARTIAL_MUST_NOT_BE_STORED"), false);
    await assert.rejects(runSelectiveVerification(input, { client }), { code: "VERIFICATION_CALL_ALREADY_CONSUMED" });
    assert.equal(calls, 1);
  } finally {
    await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
    if (path) await removeInvoiceFile(path);
  }
});
}

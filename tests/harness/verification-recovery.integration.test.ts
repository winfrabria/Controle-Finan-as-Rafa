import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildVerificationChecks, verificationResponseSchema } from "@/lib/audit-harness";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import { OpenRouterClientError } from "@/server/integrations/openrouter/client";
import { runSelectiveVerification } from "@/server/notes/run-selective-verification";
import { removeInvoiceFile, uploadInvoiceFile } from "@/server/storage";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

for (const succeeds of [true, false]) {
test(`recuperação explícita ${succeeds ? "concluída" : "interrompida"}: uma chamada, sem apagar histórico ou repetir em concorrência`, { skip: !enabled }, async () => {
  const noteId = randomUUID(); const suffix = randomUUID();
  const work = await prisma.work.create({ data: { code: `RECOVERY-${suffix}`, name: "Synthetic recovery" } });
  let path: string | undefined; let calls = 0;
  try {
    const bytes = await readFile("public/brand/favicon-32.png");
    const hash = createHash("sha256").update(bytes).digest("hex");
    path = (await uploadInvoiceFile({ bytes, contentType: "image/png", fileName: "synthetic-recovery.png", noteId, workId: work.id })).path;
    await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-recovery.png",
      originalMimeType: "image/png", originalSizeBytes: BigInt(bytes.length), originalFileSha256: hash, originalPageCount: 1,
      publicProtocol: `TEST-RECOVERY-${suffix}`, publicTokenHash: "c".repeat(64), publicTokenExpiresAt: new Date(0) } });
    const invoice = invoiceExtractionSchema.parse({ documentKind: "FISCAL_INVOICE", documentNumber: "SYNTHETIC",
      markdown: "Synthetic transport fixture, not a financial document.", readConfidence: 0.99, totalAmount: "10.00", items: [] });
    const input = { baseClassification: "OK" as const, expectedChecks: buildVerificationChecks(invoice), expectedPageCount: 1,
      fileName: "synthetic-recovery.png", filePath: path, initialFindings: [], invoice,
      mimeType: "image/png" as const, noteId, originalFileSha256: hash };
    const failure = () => new OpenRouterClientError("timeout", "Synthetic failure", false, undefined, undefined,
      { generationId: "gen-original-unknown-cost", latencyMs: 12 });
    await assert.rejects(runSelectiveVerification(input, { client: { verify: async () => { calls++; throw failure(); } } }),
      { code: "VERIFICATION_TIMEOUT" });
    const original = await prisma.aiRun.findFirstOrThrow({ where: { noteId } });
    const isolatedRecovery = { failedRunId: original.id };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const client = { verify: async () => {
      calls++; await gate;
      if (!succeeds) throw failure();
      return { model: "synthetic/verifier", attempts: 1 as const, latencyMs: 20, usage: { costUsd: 0.01 },
        data: verificationResponseSchema.parse({ status: "PASS", findings: [], limitations: [], summary: "Synthetic complete reply",
          pageCoverage: { status: "COMPLETE", expectedPageCount: 1, checkedPages: [1], missingPages: [] },
          checks: input.expectedChecks.map(check => ({ key: check.key, documentGroup: check.documentGroup,
            documentRole: check.documentRole, lineNumber: check.lineNumber, state: "VERIFIED", findingCode: null, limitationCode: null,
            evidence: [{ page: 1, field: "document", quote: "Synthetic transport fixture", source: "Synthetic" }] })) }) };
    } };
    await assert.rejects(runSelectiveVerification(input, { client }), { code: "VERIFICATION_CALL_ALREADY_CONSUMED" });
    await assert.rejects(runSelectiveVerification(input, { client, isolatedRecovery: { failedRunId: randomUUID() } }),
      { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
    await assert.rejects(runSelectiveVerification({ ...input, baseClassification: "SUSPICIOUS" }, { client, isolatedRecovery }),
      { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
    await assert.rejects(runSelectiveVerification({ ...input, expectedChecks: [] }, { client, isolatedRecovery }),
      { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
    await assert.rejects(runSelectiveVerification({ ...input, originalFileSha256: "d".repeat(64) }, { client, isolatedRecovery }),
      { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
    assert.equal(calls, 1);
    // Both contenders enter before either can finish; only one provider call.
    const attempts = [runSelectiveVerification(input, { client, isolatedRecovery }), runSelectiveVerification(input, { client, isolatedRecovery })];
    const settledPromise = Promise.allSettled(attempts);
    release();
    const settled = await settledPromise;
    assert.equal(calls, 2);
    assert.equal(settled.some(result => result.status === "fulfilled"), succeeds,
      settled.map(result => result.status === "rejected" ? String(result.reason) : "fulfilled").join("; "));
    const recovered = await prisma.aiRun.findUniqueOrThrow({ where: { idempotencyKey: `verify-recovery:${original.id}` } });
    assert.equal(recovered.status, succeeds ? "SUCCEEDED" : "FAILED");
    assert.equal((recovered.structuredResponse as Record<string, unknown>).recoveryOfRunId, original.id);
    assert.deepEqual(await prisma.aiRun.findUniqueOrThrow({ where: { id: original.id } }), original);
    assert.equal(original.costUsd, null);
    if (succeeds) {
      assert.equal((await runSelectiveVerification(input, { client })).reused, true);
      assert.equal((await runSelectiveVerification(input, { client, isolatedRecovery })).reused, true);
    } else {
      await assert.rejects(runSelectiveVerification(input, { client, isolatedRecovery }), { code: "VERIFICATION_CALL_ALREADY_CONSUMED" });
      await assert.rejects(runSelectiveVerification(input, { client }), { code: "VERIFICATION_CALL_ALREADY_CONSUMED" });
    }
    await assert.rejects(runSelectiveVerification(input, { client, isolatedRecovery: { failedRunId: recovered.id } }),
      { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
    assert.equal(calls, 2);
    // Legacy failure without its saved audit provenance cannot gain a retry.
    const record = { ...(original.structuredResponse as Record<string, unknown>) };
    delete record.requestContextFingerprint;
    await prisma.aiRun.update({ where: { id: original.id }, data: { structuredResponse: JSON.parse(JSON.stringify(record)) } });
    await assert.rejects(runSelectiveVerification(input, { client, isolatedRecovery }), { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
    assert.equal(calls, 2);
  } finally {
    await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
    if (path) await removeInvoiceFile(path);
  }
});
}

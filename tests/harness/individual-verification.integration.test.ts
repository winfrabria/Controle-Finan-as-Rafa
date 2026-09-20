import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { aiDiscoveryResponseSchema, HARNESS_VERSIONS, evaluateUniversalRules, evaluateWorkRules, individuallyConfirmedVerificationFindings, verificationFindingSchema,
  verificationResponseSchema } from "@/lib/audit-harness";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import { processNoteAudit } from "@/server/notes/process-note-audit";
import { runSelectiveVerification } from "@/server/notes/run-selective-verification";
import type { VerificationClient, VerificationRequest } from "@/server/integrations/openrouter/verification-client";
import { removeInvoiceFile, uploadInvoiceFile } from "@/server/storage";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

for (const scenario of ["missing-page", "unrelated-invalid-trace", "untraced-hypothesis", "changed-scope"] as const) {
test(`auditoria persistida ${scenario}: confirmação pontual e cobertura global permanecem separadas`, { skip: !enabled }, async () => {
  const oldMode = process.env.HARNESS_VERIFIER_MODE; process.env.HARNESS_VERIFIER_MODE = "shadow";
  const suffix = randomUUID(); const noteId = randomUUID();
  const work = await prisma.work.create({ data: { code: `INDIVIDUAL-${suffix}`, name: "Synthetic individual verification" } });
  let path: string | undefined; let discoveryCalls = 0; let verificationCalls = 0;
  let captured: VerificationRequest | undefined;
  try {
    const pdf = await PDFDocument.create();
    for (const text of ["Recibo. Total R$ 83,00", "Pagamento. Pago R$ 85,00", "Contexto sintetico nao conferido pelo mock"]) {
      pdf.addPage().drawText(text);
    }
    const bytes = Buffer.from(await pdf.save()); const hash = createHash("sha256").update(bytes).digest("hex");
    path = (await uploadInvoiceFile({ bytes, contentType: "application/pdf", fileName: "synthetic-individual.pdf", noteId, workId: work.id })).path;
    const invoice = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", documentNumber: "SYNTHETIC-INDIVIDUAL",
      totalAmount: "83.00", readConfidence: 0.99, markdown: "Documento sintético com leitura parcial. Recibo83,00 e pagamento85,00.",
      items: [{ lineNumber: 1, description: "Produto de teste", quantity: "1", unitPrice: "83.00", totalAmount: "83.00",
        documentRole: "LINE_ITEM", countsTowardDocumentTotal: true, sourceKind: "RECEIPT", sourcePage: 1, sourceText: "Recibo. Total R$ 83,00" }] });
    await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-individual.pdf",
      originalMimeType: "application/pdf", originalSizeBytes: BigInt(bytes.length), originalFileSha256: hash, originalPageCount: 3,
      publicProtocol: `TEST-INDIVIDUAL-${suffix}`, publicTokenHash: "c".repeat(64), publicTokenExpiresAt: new Date(0),
      extractedData: invoice, status: "PROCESSING", processingStage: "ANALYZING" } });
    const discovery = aiDiscoveryResponseSchema.parse({ findings: [{ code: "PARTIAL_DOCUMENT_AMOUNT_CONFLICT", source: "AI_DISCOVERY",
      category: "AMOUNT", confidence: 0.9, severity: "WARNING", title: "Valores diferentes", description: "Recibo e pagamento mostram valores diferentes.",
      justification: "Conferir os dois registros originais.", references: ["Página 1", "Página 2"], comparisonMode: "CONFLICT", referenceBasis: null,
      expectedValue: null, actualValue: "R$ 83,00 e R$ 85,00", noteItemLineNumber: 1,
      evidence: { field: "amount", page: 1, lineNumber: 1, source: "Original sintético", summary: "Dois totais distintos", claimScope: "DOCUMENT_CONTENT",
        observations: [{ kind: "RECEIPT", label: "Recibo", page: 1, text: "Total R$ 83,00", value: "83.00" },
          { kind: "PAYMENT", label: "Pagamento", page: 2, text: "Pago R$ 85,00", value: "85.00" }] } }],
      needsContext: false, contextQuestions: [], coverage: { sufficientEvidence: false, checkedAreas: ["AMOUNT"], limitations: ["Página3 não conferida"] },
      summary: "Hipótese sintética sobre as páginas legíveis." });
    const verificationClient: VerificationClient = { verify: async request => {
      verificationCalls++; captured = request;
      const finding = verificationFindingSchema.parse({ ...discovery.findings[0], source: "AI_VERIFICATION",
        confirmsInitialFindingCode: discovery.findings[0].code });
      if (scenario === "changed-scope") finding.evidence.claimScope = "WORK_AUTHORIZATION";
      const data = verificationResponseSchema.parse({ status: "LIMITED", findings: [finding], limitations: ["Página3 não conferida"],
        summary: "Resposta sintética, não é medição de qualidade de IA.", pageCoverage: { status: "INCOMPLETE", expectedPageCount: 3,
          checkedPages: [1, 2], missingPages: [3] },
        checks: request.expectedChecks.map(check => ({ key: check.key, documentGroup: check.documentGroup, documentRole: check.documentRole,
          lineNumber: check.lineNumber, state: check.hypothesisReview ? "FINDING" : "LIMITATION", findingCode: check.hypothesisReview ? finding.code : null,
          limitationCode: check.hypothesisReview ? null : "PARTIAL_READING", evidence: discovery.findings[0].evidence.observations!.map(source => ({
            field: "amount", page: source.page, source: source.label, quote: source.text })),
          comparison: check.hypothesisReview ? { outcome: "CONFLICT", basis: "Mesma transação sintética, dois totais sem ajuste explícito.",
            leftEvidenceIndex: 0, rightEvidenceIndex: 1 } : null })) });
      if (scenario === "unrelated-invalid-trace") data.checks[0].evidence[0].page = 900;
      if (scenario === "untraced-hypothesis") data.checks.find(check => check.key.startsWith("hypothesis:"))!.evidence[1].quote = "Pagamento sem valor transcrito";
      return { attempts: 1, model: "synthetic/verifier", provider: "local-mock", latencyMs: 1, usage: { costUsd: 0 }, data };
    } };
    await processNoteAudit(noteId, { client: { discover: async () => {
      discoveryCalls++; return { data: discovery, attempts: 1, attemptTrace: [], model: "synthetic/discovery", provider: "local-mock", latencyMs: 1, usage: { costUsd: 0 } };
    } }, verificationClient });
    const after = await prisma.note.findUniqueOrThrow({ where: { id: noteId }, include: { findings: { where: { status: "OPEN" } } } });
    const accepted = scenario === "missing-page" || scenario === "unrelated-invalid-trace";
    assert.equal(after.classification, accepted ? "SUSPICIOUS" : "NO_PARAMETER");
    assert.equal(after.assuranceBand, "LIMITED"); assert.equal(after.processingStage, "COMPLETED");
    assert.deepEqual(after.findings.map(finding => finding.code), accepted ? [discovery.findings[0].code] : []);
    if (accepted) assert.equal(after.findings[0].source, "AI_VERIFICATION");
    assert.equal(await prisma.noteContextQuestion.count({ where: { noteId } }), 0);
    assert.equal(discoveryCalls, 1); assert.equal(verificationCalls, 1);
    if (scenario === "missing-page") {
      // A policy-only recheck may replay identical discovery, never changed
      // invoice/context or a different response hidden behind the same report.
      assert(captured);
      const currentAudit = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "AUDIT" } });
      const sourcePolicyVersion = "synthetic-previous-policy";
      const rules = captured.workRules ?? [];
      const sourceAuditRequestFingerprint = createHash("sha256").update(JSON.stringify({
        contextAnswers: [], contextRound: after.contextRound, invoice: captured.invoice, workRules: rules,
        deterministicFindings: [...evaluateUniversalRules({ invoice: captured.invoice, duplicates: [] }).findings,
          ...evaluateWorkRules(captured.invoice, rules).findings], partialAiAudit: true,
        versions: { ...HARNESS_VERSIONS, policy: sourcePolicyVersion },
      })).digest("hex");
      const source = await prisma.aiRun.create({ data: { kind: "AUDIT", status: "SUCCEEDED", noteId,
        model: "synthetic/previous-discovery", idempotencyKey: `synthetic-previous:${suffix}`,
        requestFingerprint: sourceAuditRequestFingerprint, policyVersion: sourcePolicyVersion,
        promptVersion: HARNESS_VERSIONS.prompt, schemaVersion: HARNESS_VERSIONS.schema,
        reasoningEffort: "LOW", structuredResponse: currentAudit.structuredResponse!, costUsd: 0 } });
      const replay = { sourcePolicyVersion, sourceAuditRequestFingerprint, sourceAuditRunId: source.id, sourceReportSha256: "a".repeat(64) };
      let replays = 0;
      const client = { discover: async () => { replays++; return { data: discovery, attempts: 0, attemptTrace: [],
        model: "local/replay", provider: "local", latencyMs: 0, usage: { costUsd: 0 } }; } };
      const dependencies = { client, verificationClient, isolatedDiscoveryReplay: replay };
      await prisma.note.update({ where: { id: noteId }, data: { processingStage: "ANALYZING", status: "PROCESSING" } });
      await assert.rejects(processNoteAudit(noteId, { ...dependencies, isolatedDiscoveryReplay: { ...replay,
        sourcePolicyVersion: HARNESS_VERSIONS.policy } }), { code: "AUDIT_REPLAY_CONTEXT_CHANGED" });
      await assert.rejects(processNoteAudit(noteId, { ...dependencies, isolatedDiscoveryReplay: { ...replay,
        sourceReportSha256: "invalid" } }), { code: "AUDIT_REPLAY_CONTEXT_CHANGED" });
      await prisma.note.update({ where: { id: noteId }, data: { extractedData: { ...invoice, totalAmount: "84.00" } } });
      await assert.rejects(processNoteAudit(noteId, dependencies), { code: "AUDIT_REPLAY_CONTEXT_CHANGED" });
      await prisma.note.update({ where: { id: noteId }, data: { extractedData: invoice } });
      assert.equal(replays, 0); assert.equal(verificationCalls, 1);
      await assert.rejects(processNoteAudit(noteId, { ...dependencies, client: { discover: async () => ({
        ...await client.discover(), data: { ...discovery, summary: "Changed discovery must not reach verification" },
      }) } }), { code: "AUDIT_REPLAY_DISCOVERY_CHANGED" });
      assert.equal(verificationCalls, 1);
      await prisma.note.update({ where: { id: noteId }, data: { processingStage: "ANALYZING", status: "PROCESSING" } });
      await processNoteAudit(noteId, dependencies);
      assert.equal(replays, 2); assert.equal(verificationCalls, 1, "Identical verification is reused without another call");
      assert.deepEqual(await prisma.aiRun.findUniqueOrThrow({ where: { id: source.id } }), source);
      const originalVerifier = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "VERIFICATION" } });
      const input = { ...captured, filePath: path, noteId, originalFileSha256: hash };
      const offline = { isolatedReplay: { sourceRunId: originalVerifier.id }, client: {
        verify: async () => { throw new Error("OFFLINE_REPLAY_MUST_NEVER_CALL_PROVIDER"); } } };
      const count = await prisma.aiRun.count({ where: { noteId } });
      const revalidated = await runSelectiveVerification(input, offline);
      assert.equal(revalidated.revalidated, true); assert.equal(revalidated.reused, true);
      assert.equal(revalidated.coverage.complete, false);
      for (const changed of [{ ...input, originalFileSha256: "e".repeat(64) }, { ...input, expectedPageCount: 4 },
        { ...input, expectedChecks: [] }, { ...input, initialFindings: [] }]) {
        await assert.rejects(runSelectiveVerification(changed, offline), { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
      }
      await assert.rejects(runSelectiveVerification(input, { ...offline, isolatedReplay: { sourceRunId: source.id } }),
        { code: "VERIFICATION_RECOVERY_NOT_ALLOWED" });
      assert.equal(await prisma.aiRun.count({ where: { noteId } }), count);
      assert.deepEqual(await prisma.aiRun.findUniqueOrThrow({ where: { id: originalVerifier.id } }), originalVerifier);
      await prisma.note.update({ where: { id: noteId }, data: { processingStage: "ANALYZING", status: "PROCESSING" } });
      await processNoteAudit(noteId, { ...dependencies, isolatedVerificationReplay: offline.isolatedReplay });
      assert.equal(verificationCalls, 1);
    }
    if (scenario === "unrelated-invalid-trace") {
      const run = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "VERIFICATION" } });
      assert.equal(run.status, "FAILED"); assert.equal(run.errorCode, "VERIFICATION_TRACE_INVALID");
      assert(captured);
      const reused = await runSelectiveVerification({ ...captured, filePath: path, noteId, originalFileSha256: hash },
        { client: { verify: async () => { throw new Error("NO_NEW_PROVIDER_CALL_ALLOWED"); } } });
      assert.equal(reused.reused, true); assert.equal(reused.responseRejected, true); assert.equal(reused.coverage.complete, false);
      assert.equal(individuallyConfirmedVerificationFindings({ ...captured, response: reused.data }, { requireIndividualTrace: true }).length, 1);
      assert.deepEqual(await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }), run);
    }
  } finally {
    await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
    await prisma.work.delete({ where: { id: work.id } });
    if (path) await removeInvoiceFile(path);
    if (oldMode === undefined) delete process.env.HARNESS_VERIFIER_MODE; else process.env.HARNESS_VERIFIER_MODE = oldMode;
  }
});
}

import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { aiDiscoveryResponseSchema, verificationFindingSchema, verificationResponseSchema } from "@/lib/audit-harness";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import { processNoteAudit } from "@/server/notes/process-note-audit";
import { removeInvoiceFile, uploadInvoiceFile } from "@/server/storage";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

for (const scenario of ["confirmed", "wrong-source", "authorization"] as const) {
  test(`par monetário ${scenario}: auditoria sem hipótese inicial persiste somente confirmação própria`, { skip: !enabled }, async () => {
    const oldMode = process.env.HARNESS_VERIFIER_MODE; process.env.HARNESS_VERIFIER_MODE = "shadow";
    const suffix = randomUUID(), noteId = randomUUID();
    const work = await prisma.work.create({ data: { code: `PAIR-${suffix}`, name: "Synthetic monetary pair" } });
    let path: string | undefined, verificationCalls = 0;
    try {
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText("Venda. Total Geral 89,00. Debito R$ 86,00.");
      pdf.addPage().drawText("Contexto sintetico nao conferido pelo mock.");
      const bytes = Buffer.from(await pdf.save());
      path = (await uploadInvoiceFile({ bytes, contentType: "application/pdf", fileName: "synthetic-pair.pdf", noteId, workId: work.id })).path;
      const invoice = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", documentNumber: "SYNTHETIC-PAIR", totalAmount: "89.00", readConfidence: 0.99,
        markdown: "Venda e pagamento sintéticos para testar a persistência da comparação entre duas fontes documentais.", items: [{ lineNumber: 1, sourceKind: "SALE", sourcePage: 1,
          sourceText: "Venda. Total Geral 89,00", totalAmount: "89.00", description: "Produto sintético",
          evidenceObservations: [{ kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", page: 1, amount: "86.00", text: "Débito R$ 86,00" }] }] });
      await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-pair.pdf",
        originalMimeType: "application/pdf", originalSizeBytes: BigInt(bytes.length), originalFileSha256: createHash("sha256").update(bytes).digest("hex"),
        originalPageCount: 2, publicProtocol: `TEST-PAIR-${suffix}`, publicTokenHash: "c".repeat(64), publicTokenExpiresAt: new Date(0),
        extractedData: invoice, status: "PROCESSING", processingStage: "ANALYZING" } });
      const discovery = aiDiscoveryResponseSchema.parse({ findings: [], needsContext: false, contextQuestions: [],
        coverage: { sufficientEvidence: false, checkedAreas: ["AMOUNT"], limitations: ["Contexto não conferido"] }, summary: "Sem hipótese inicial." });
      await processNoteAudit(noteId, { client: { discover: async () => ({ data: discovery, attempts: 1, attemptTrace: [],
        model: "synthetic/discovery", provider: "local-mock", latencyMs: 1, usage: { costUsd: 0 } }) }, verificationClient: { verify: async request => {
        verificationCalls++;
        assert.equal(request.initialFindings.filter(finding => finding.source === "AI_DISCOVERY").length, 0);
        assert.equal(request.expectedChecks.filter(check => check.amountPair).length, 1);
        const finding = verificationFindingSchema.parse({ code: "NEW_PAYMENT_CONFLICT", source: "AI_VERIFICATION", confirmsInitialFindingCode: null,
          category: "AMOUNT", confidence: 0.9, severity: "WARNING", title: "Valores diferentes", description: "Venda e pagamento mostram valores diferentes.",
          justification: "Dois totais da mesma operação, sem ajuste documentado.", references: ["Página 1"], comparisonMode: "CONFLICT", referenceBasis: null,
          expectedValue: null, actualValue: "R$ 89,00 e R$ 86,00", noteItemLineNumber: 1,
          evidence: { field: "amount", page: 1, lineNumber: 1, source: "DOCUMENTO", summary: "Totais diferentes", claimScope: "DOCUMENT_CONTENT",
            observations: [{ kind: "SALE", label: "Venda", page: 1, text: "Total Geral 89,00", value: "89.00" },
              { kind: "PAYMENT", label: "Débito", page: 1, text: "Débito R$ 86,00", value: "86.00" }] } });
        if (scenario === "authorization") finding.evidence.claimScope = "WORK_AUTHORIZATION";
        if (scenario === "wrong-source") finding.evidence.observations![1].kind = "RECEIPT";
        return { attempts: 1, model: "synthetic/verifier", provider: "local-mock", latencyMs: 1, usage: { costUsd: 0 },
          data: verificationResponseSchema.parse({ status: "LIMITED", summary: "Contexto não conferido", findings: [finding], limitations: ["Página 2 não conferida"],
            pageCoverage: { status: "INCOMPLETE", expectedPageCount: 2, checkedPages: [1], missingPages: [2] },
            checks: request.expectedChecks.map(check => ({ key: check.key, lineNumber: check.lineNumber, documentGroup: check.documentGroup,
              documentRole: check.documentRole, state: check.amountPair ? "FINDING" : "LIMITATION", findingCode: check.amountPair ? finding.code : null,
              limitationCode: check.amountPair ? null : "PARTIAL_READING", evidence: [
                { source: "SALE", page: 1, field: "valor", quote: "Total Geral 89,00" },
                { source: "PAYMENT", page: 1, field: "valor", quote: "Débito R$ 86,00" } ],
              comparison: check.amountPair ? { outcome: "CONFLICT", basis: "Totais da mesma operação sem ajuste documentado.",
                leftEvidenceIndex: 0, rightEvidenceIndex: 1 } : null })) }) };
      } } });
      const after = await prisma.note.findUniqueOrThrow({ where: { id: noteId }, include: { findings: { where: { status: "OPEN" } } } });
      assert.equal(after.processingStage, "COMPLETED"); assert.equal(after.assuranceBand, "LIMITED");
      assert.deepEqual(after.findings.map(finding => finding.code), scenario === "confirmed" ? ["NEW_PAYMENT_CONFLICT"] : []);
      assert.equal(after.classification, scenario === "confirmed" ? "SUSPICIOUS" : "NO_PARAMETER");
      assert.equal(await prisma.noteContextQuestion.count({ where: { noteId } }), 0);
      assert.equal(verificationCalls, 1);
    } finally {
      if (path) await removeInvoiceFile(path);
      await prisma.note.deleteMany({ where: { id: noteId } });
      await prisma.work.delete({ where: { id: work.id } });
      if (oldMode === undefined) delete process.env.HARNESS_VERIFIER_MODE; else process.env.HARNESS_VERIFIER_MODE = oldMode;
    }
  });
}

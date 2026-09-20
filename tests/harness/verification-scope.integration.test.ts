import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aiDiscoveryFindingSchema, buildVerificationChecks, verificationFindingSchema, type WorkRuleInput } from "@/lib/audit-harness";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { prisma } from "@/server/db/prisma";
import { OpenRouterVerificationClient } from "@/server/integrations/openrouter/verification-client";
import { runSelectiveVerification } from "@/server/notes/run-selective-verification";
import { removeInvoiceFile, uploadInvoiceFile } from "@/server/storage";
import { assertIsolatedHarnessTargets } from "@/server/testing/isolated-harness";

const enabled = process.env.HARNESS_DATABASE_TESTS === "1";
if (enabled) assertIsolatedHarnessTargets();
test.after(async () => { await prisma.$disconnect(); });

for (const scenario of ["same", "changed", "omitted", "authorization", "unknown-rule", "missing-rules"] as const) {
  test(`escopo ${scenario}: contrato HTTP e persistência isolada mantêm a identidade da alegação`, { skip: !enabled }, async () => {
    const suffix = randomUUID(); const noteId = randomUUID();
    const work = await prisma.work.create({ data: { code: `SCOPE-${suffix}`, name: "Synthetic scope persistence" } });
    let path: string | undefined; let calls = 0;
    try {
      const bytes = await readFile("public/brand/favicon-32.png");
      const hash = createHash("sha256").update(bytes).digest("hex");
      path = (await uploadInvoiceFile({ bytes, contentType: "image/png", fileName: "synthetic-scope.png", noteId, workId: work.id })).path;
      await prisma.note.create({ data: { id: noteId, workId: work.id, originalFilePath: path, originalFileName: "synthetic-scope.png",
        originalMimeType: "image/png", originalSizeBytes: BigInt(bytes.length), originalFileSha256: hash, originalPageCount: 1,
        publicProtocol: `TEST-SCOPE-${suffix}`, publicTokenHash: "c".repeat(64), publicTokenExpiresAt: new Date(0) } });
      const invoice = invoiceExtractionSchema.parse({ documentKind: "FISCAL_INVOICE", documentNumber: "SYNTHETIC-SCOPE",
        markdown: "Dados sintéticos de transporte e persistência; a imagem não é uma despesa nem uma prova de extração.", readConfidence: 0.99, totalAmount: "10.00", items: [] });
      const initial = aiDiscoveryFindingSchema.parse({ code: "PRODUCT_SPECIFICATION_CONFLICT", category: "PRODUCT", severity: "WARNING",
        source: "AI_DISCOVERY", confidence: 0.9, title: "Especificações diferentes", description: "Tipos diferentes entre duas fontes.",
        justification: "Comparação documental sintética.", references: ["Página 1"], comparisonMode: "CONFLICT", referenceBasis: null,
        expectedValue: null, actualValue: "Tipo A e Tipo B", noteItemLineNumber: null,
        evidence: { field: "especificação do material", page: 1, lineNumber: null, source: "Documento sintético", summary: "Dois tipos informados.",
          claimScope: "DOCUMENT_CONTENT", observations: [
            { kind: "FISCAL_LINE", label: "Fiscal", page: 1, text: "Cabo Tipo A", value: "Tipo A" },
            { kind: "SHEET", label: "Controle", page: 1, text: "Veículo: Cabo Tipo B", value: "Tipo B" },
          ] } });
      const workRules: WorkRuleInput[] = [{ code: "SYNTHETIC_ALLOWED_TYPES", name: "Tipos permitidos", category: "PRODUCT",
        severity: "WARNING", configuration: { allowed: ["Tipo A"], documentGroup: "synthetic" } }];
      const authorization = ["authorization", "unknown-rule", "missing-rules"].includes(scenario);
      if (authorization) {
        initial.evidence.claimScope = "WORK_AUTHORIZATION";
        initial.references = ["Página 1", workRules[0].code];
      }
      const verified = verificationFindingSchema.parse({ ...initial, source: "AI_VERIFICATION", confirmsInitialFindingCode: initial.code });
      if (scenario === "unknown-rule") verified.references = ["Página 1", "RULE_NOT_PROVIDED"];
      if (scenario === "changed") verified.evidence.claimScope = "WORK_AUTHORIZATION";
      if (scenario === "omitted") delete verified.evidence.claimScope;
      const expectedChecks = buildVerificationChecks(invoice);
      const input = { baseClassification: "INFORMATION_INSUFFICIENT" as const, expectedChecks, expectedPageCount: 1,
        fileName: "synthetic-scope.png", filePath: path, initialFindings: [initial], invoice,
        mimeType: "image/png" as const, noteId, originalFileSha256: hash,
        workRules: scenario === "missing-rules" ? [] : workRules };
      // Real HTTP serializer/parser and real local persistence; only the model
      // response is simulated. Never call an external model in this suite.
      const client = new OpenRouterVerificationClient({ apiKey: "offline-only", model: "openai/gpt-5.6-sol", maxTokens: 2048,
        pdfEngine: "native", reasoningEffort: "high", timeoutMs: 2000,
        fetchImplementation: async (_url, init) => {
          calls++;
          const body = JSON.parse(String(init?.body));
          const sent = JSON.parse(body.messages[1].content[0].text);
          assert.equal(sent.initialFindings[0].evidence.claimScope, authorization ? "WORK_AUTHORIZATION" : "DOCUMENT_CONTENT");
          assert.deepEqual(sent.workRules, input.workRules);
          assert.ok(body.response_format.json_schema.schema.properties.findings.items.properties.evidence.required.includes("claimScope"));
          const response = { status: "FINDINGS", findings: [verified], limitations: [], summary: "Resposta sintética.",
            pageCoverage: { status: "COMPLETE", expectedPageCount: 1, checkedPages: [1], missingPages: [] },
            checks: expectedChecks.map((check, index) => ({ key: check.key, state: index === 0 ? "FINDING" : "VERIFIED",
              findingCode: index === 0 ? initial.code : null, limitationCode: null,
              evidence: [{ page: 1, field: "produto", quote: "Cabo Tipo A; controle Cabo Tipo B.", source: "Sintético" }] })) };
          return new Response(JSON.stringify({ model: "openai/gpt-5.6-sol", id: `gen-synthetic-${scenario}`,
            choices: [{ message: { content: JSON.stringify(response) } }] }), { headers: { "Content-Type": "application/json" } });
        },
      });
      const succeeds = scenario === "same" || scenario === "authorization";
      const expectedError = authorization ? "VERIFICATION_UNSUPPORTED_FINDING" : "VERIFICATION_TRACE_INVALID";
      if (succeeds) {
        const first = await runSelectiveVerification(input, { client });
        assert.equal(first.coverage.complete, true); assert.equal(first.reused, false);
        const second = await runSelectiveVerification(input, { client });
        assert.equal(second.reused, true);
        assert.equal(second.data.findings[0].evidence.claimScope, authorization ? "WORK_AUTHORIZATION" : "DOCUMENT_CONTENT");
        // A newly required hypothesis check cannot purchase another call; nor
        // may a changed claim reuse a previous disposition under the same code.
        const withReviews = await runSelectiveVerification({ ...input, expectedChecks: buildVerificationChecks(invoice, [initial]) }, { client });
        assert.equal(withReviews.reused, true); assert.equal(withReviews.coverage.complete, false);
        assert.deepEqual(withReviews.coverage.missingKeys, ["hypothesis:1"]);
        const changedHypothesis = structuredClone(initial);
        changedHypothesis.evidence.observations![1].value = "Tipo C";
        changedHypothesis.evidence.observations![1].text = "Cabo Tipo C";
        await assert.rejects(runSelectiveVerification({ ...input, initialFindings: [changedHypothesis],
          expectedChecks: buildVerificationChecks(invoice, [changedHypothesis]) }, { client }), { code: "VERIFICATION_HYPOTHESES_CHANGED" });
        assert.equal(calls, 1);
        const reordered = [{ ...workRules[0], configuration: { documentGroup: "synthetic", allowed: ["Tipo A"] } }];
        assert.equal((await runSelectiveVerification({ ...input, workRules: reordered }, { client })).reused, true);
        for (const changedRules of [[], [{ ...workRules[0], configuration: { allowed: ["Tipo B"], documentGroup: "synthetic" } }],
          [{ ...workRules[0], code: "DIFFERENT_CODE" }]]) {
          await assert.rejects(runSelectiveVerification({ ...input, workRules: changedRules }, { client }),
            { code: "VERIFICATION_REFERENCE_CHANGED" });
        }
      } else {
        await assert.rejects(runSelectiveVerification(input, { client }), { code: expectedError });
        await assert.rejects(runSelectiveVerification(input, { client }), { code: "VERIFICATION_CALL_ALREADY_CONSUMED" });
      }
      const run = await prisma.aiRun.findFirstOrThrow({ where: { noteId, kind: "VERIFICATION" } });
      assert.equal(run.status, succeeds ? "SUCCEEDED" : "FAILED");
      assert.equal(run.errorCode, succeeds ? null : expectedError);
      assert.equal(run.costUsd, null); assert.equal(calls, 1);
      if (!succeeds) {
        const rejected = run.structuredResponse as Record<string, unknown>;
        assert.equal(rejected.response, undefined);
        assert.ok(rejected.rejectedResponse, "A completed final answer remains quarantined for offline diagnosis.");
        assert.ok(rejected.rejectedCoverage, "The exact rejected trace remains available without another provider call.");
        assert.equal(await prisma.finding.count({ where: { aiRunId: run.id } }), 0);
      }
      if (succeeds) {
        // Historical success without a reference snapshot cannot prove these
        // supplied rules were ever seen. It must not buy another call either.
        const record = JSON.parse(JSON.stringify(run.structuredResponse));
        delete record.workRulesFingerprint;
        await prisma.aiRun.update({ where: { id: run.id }, data: { structuredResponse: record } });
        await assert.rejects(runSelectiveVerification(input, { client }), { code: "VERIFICATION_REFERENCE_CHANGED" });
        assert.equal(calls, 1);
      }
    } finally {
      await prisma.note.deleteMany({ where: { id: noteId, workId: work.id } });
      await prisma.work.delete({ where: { id: work.id } });
      if (path) await removeInvoiceFile(path);
    }
  });
}

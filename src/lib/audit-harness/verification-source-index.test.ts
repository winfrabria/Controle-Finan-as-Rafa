import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { harnessFindingSchema, type HarnessInvoice } from "./contracts";
import { verificationHypothesisTransport, verificationSourceIndex } from "./verification-source-index";

function invoice() {
  return invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", totalAmount: "917.25", readConfidence: 0.95,
    supplierName: "UPSTREAM_ENTITY", documentNumber: "UPSTREAM_NUMBER", markdown: "UPSTREAM_OCR 917,25",
    issuedAt: "2026-02-03", warnings: ["UPSTREAM_WARNING"],
    items: [{ lineNumber: 1, description: "UPSTREAM_DESCRIPTION", documentGroup: "UPSTREAM_GROUP",
      sourcePage: 2, sourceKind: "SHEET", sourceDate: "2026-02-03", totalAmount: "917.25",
      sourceText: "UPSTREAM_SOURCE 917,25", evidenceObservations: [
        { kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", amount: "918.25", date: "2026-02-03", page: 3,
          label: "UPSTREAM_LABEL", text: "UPSTREAM_QUOTE 918,25" },
      ] }], pageCoverage: [{ page: 2, complete: true, sources: [{ kind: "SHEET", count: 1 }],
        fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null },
        { page: 3, complete: true, sources: [{ kind: "PAYMENT", count: 1 }],
          fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null }],
  });
}
function finding(source: "AI_DISCOVERY" | "UNIVERSAL_RULE" | "WORK_RULE") {
  return harnessFindingSchema.parse({ code: "SYNTHETIC_CONFLICT", title: "UPSTREAM_TITLE 917,25",
    description: "UPSTREAM_DESCRIPTION 918,25", category: "INTERNAL_CONSISTENCY", severity: "WARNING", source,
    confidence: 0.9, justification: "UPSTREAM_REASON", references: ["UPSTREAM_REFERENCE"],
    evidence: { field: "UPSTREAM_FIELD", summary: "UPSTREAM_SUMMARY", page: 3 },
    expectedValue: "917.25", actualValue: "918.25", noteItemLineNumber: 1 });
}

test("índice do verificador não transporta texto, valores, datas ou entidades da primeira leitura", () => {
  const data = invoice(), before = structuredClone(data);
  const index = verificationSourceIndex(data);
  assert.doesNotMatch(JSON.stringify(index), /UPSTREAM|917|918|2026-02-03/);
  assert.equal(index.items[0].lineNumber, 1);
  assert.equal(index.items[0].sourcePage, 2);
  assert.deepEqual(index.items[0].evidenceObservations, [{ kind: "PAYMENT", page: 3 }]);
  assert.deepEqual(data, before);
  assert.equal("complete" in index.pageInventory[0], false);
});

test("índice mantém todas as localizações sem adivinhar campos ausentes", () => {
  const data = invoice(); data.items[0].sourcePage = null;
  data.items[0].evidenceObservations.push({ ...data.items[0].evidenceObservations[0], amount: "0.00" });
  const index = verificationSourceIndex(data);
  assert.equal(index.items[0].sourcePage, null);
  assert.equal(index.items[0].evidenceObservations.length, 2);
  assert.deepEqual(index.pageInventory.map(page => page.page), [2, 3]);
  assert.equal("amount" in index.items[0].evidenceObservations[0], false);
});

test("extração legada sem observações ou inventário não quebra o transporte", () => {
  const data: HarnessInvoice = invoice();
  delete data.items[0].evidenceObservations;
  const index = verificationSourceIndex({ ...data, pageCoverage: undefined });
  assert.deepEqual(index.items[0].evidenceObservations, []);
  assert.deepEqual(index.pageInventory, []);
  assert.equal(index.items[0].sourcePage, 2);
});

test("alertas locais não fornecem valores ou citações para o verificador copiar", () => {
  for (const source of ["UNIVERSAL_RULE", "WORK_RULE"] as const) {
    const local = finding(source), before = structuredClone(local);
    assert.deepEqual(verificationHypothesisTransport([local]), [{ code: local.code, source,
      category: local.category, noteItemLineNumber: 1 }]);
    assert.doesNotMatch(JSON.stringify(verificationHypothesisTransport([local])), /UPSTREAM|917|918/);
    assert.deepEqual(local, before);
  }
});

test("hipóteses de descoberta conservam identidade e posição para confirmação exata no servidor", () => {
  const hypotheses = [finding("UNIVERSAL_RULE"), finding("AI_DISCOVERY"), finding("WORK_RULE")];
  const before = structuredClone(hypotheses), payload = verificationHypothesisTransport(hypotheses);
  assert.equal(payload.length, 3);
  assert.deepEqual(payload[1], hypotheses[1]);
  assert.deepEqual(hypotheses, before);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessInvoice } from "./contracts";
import { decideClassification } from "./decision-matrix";
import { evaluateHarness } from "./engine";

const sparseInvoice: HarnessInvoice = {
  documentNumber: null,
  supplierName: "Fornecedor",
  supplierTaxId: null,
  issuedAt: null,
  totalAmount: "10.00",
  readConfidence: 0.95,
  warnings: [],
  markdown: "",
  items: [],
};

test("prioriza READ_FAILED e usa NO_PARAMETER sem achado nem cobertura", () => {
  assert.equal(decideClassification({ readFailed: true, deterministicCoverage: true, aiCoverage: true, findings: [] }), "READ_FAILED");
  assert.equal(evaluateHarness({ invoice: sparseInvoice }).classification, "NO_PARAMETER");
  assert.equal(evaluateHarness({ invoice: { ...sparseInvoice, readConfidence: 0.3 } }).classification, "READ_FAILED");
});

test("qualquer achado sustentado exige classificação suspeita", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: false,
    aiCoverage: false,
    findings: [{
      code: "X", title: "X", description: "X", category: "X", severity: "WARNING",
      source: "AI_DISCOVERY", confidence: 0.8, justification: "Evidência objetiva.",
      references: ["DANFE:campo:value"],
      evidence: { field: "value" }, expectedValue: null, actualValue: "value",
      noteItemLineNumber: null,
    }],
  }), "SUSPICIOUS");
});

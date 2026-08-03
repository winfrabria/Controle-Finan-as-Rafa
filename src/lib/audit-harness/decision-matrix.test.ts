import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessInvoice } from "./contracts";
import { decideClassification } from "./decision-matrix";
import { evaluateHarness } from "./engine";
import { isReadFailure } from "./policy";

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

test("prioriza READ_FAILED e pede contexto sem achado nem cobertura", () => {
  assert.equal(decideClassification({ readFailed: true, deterministicCoverage: true, aiCoverage: true, findings: [] }), "READ_FAILED");
  assert.equal(evaluateHarness({ invoice: sparseInvoice }).classification, "NEEDS_CONTEXT");
  assert.equal(evaluateHarness({ invoice: { ...sparseInvoice, readConfidence: 0.3 } }).classification, "READ_FAILED");
});

test("reembolso composto legível segue para auditoria mesmo sem identidade única", () => {
  const reimbursement: HarnessInvoice = {
    documentNumber: null,
    supplierName: null,
    supplierTaxId: null,
    issuedAt: null,
    totalAmount: "551.90",
    readConfidence: 0.97,
    warnings: ["Documento é uma ficha de reembolso com múltiplos fornecedores e comprovantes."],
    markdown: "Ficha de reembolso com 22 comprovantes.",
    items: Array.from({ length: 22 }, (_, index) => ({
      lineNumber: index + 1,
      description: `Despesa ${index + 1}`,
      quantity: "1",
      unitPrice: "25.00",
      totalAmount: "25.00",
    })),
  };

  assert.equal(isReadFailure(reimbursement), false);
  assert.notEqual(evaluateHarness({ invoice: reimbursement }).classification, "READ_FAILED");
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
      evidence: { field: "value", summary: "O campo diverge do documento." }, expectedValue: null, actualValue: "value",
      noteItemLineNumber: null,
    }],
  }), "SUSPICIOUS");
});

test("achado livre sem localização e evidência concreta não sustenta suspeita", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: true,
    findings: [{
      code: "X", title: "X", description: "X", category: "X", severity: "WARNING",
      source: "AI_DISCOVERY", confidence: 0.99, justification: "Parece inconsistente.",
      references: [], evidence: { field: "" }, expectedValue: null, actualValue: null,
      noteItemLineNumber: null,
    }],
  }), "OK");
});

test("contexto necessário não vira suspeita sem achado sustentado", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: false,
    contextRequired: true,
    contextQuestions: 1,
    findings: [],
  }), "NEEDS_CONTEXT");
});

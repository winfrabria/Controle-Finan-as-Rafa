import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_POLICY, selectReasoningEffort } from "./policy";

test("mantém Terra high como primário e Sol high como recuperação", () => {
  assert.equal(AUDIT_POLICY.version, "2026-09-06.1");
  assert.equal(AUDIT_POLICY.defaultReasoningEffort, "high");
  assert.equal(AUDIT_POLICY.fallbackReasoningEffort, "high");

  const selection = selectReasoningEffort(
    {
      documentNumber: "1",
      supplierName: "Fornecedor",
      supplierTaxId: null,
      issuedAt: "2026-08-08",
      totalAmount: "10.00",
      readConfidence: 0.95,
      warnings: [],
      markdown: "Nota fiscal",
      items: [],
    },
    [],
  );

  assert.equal(selection.effort, "high");
});

test("eleva para xhigh somente quando um gatilho complexo está presente", () => {
  const baseInvoice = {
    documentNumber: "synthetic-1",
    supplierName: "Fornecedor sintético",
    supplierTaxId: null,
    issuedAt: "2026-08-08",
    totalAmount: "50000.00",
    readConfidence: 0.95,
    warnings: [],
    markdown: "Documento sintético",
    items: [],
  };
  const highValue = selectReasoningEffort(baseInvoice, []);
  assert.equal(highValue.effort, "xhigh");
  assert.deepEqual(highValue.triggers, ["HIGH_VALUE"]);

  const critical = selectReasoningEffort(
    { ...baseInvoice, totalAmount: "10.00" },
    [{
      code: "SYNTHETIC_CRITICAL",
      title: "Achado sintético",
      description: "Divergência objetiva em caso sintético.",
      category: "ARITHMETIC",
      severity: "CRITICAL",
      source: "UNIVERSAL_RULE",
      confidence: 0.99,
      justification: "A evidência sintética sustenta a divergência.",
      references: ["synthetic:1"],
      evidence: { field: "total" },
      expectedValue: "10.00",
      actualValue: "12.00",
      noteItemLineNumber: null,
    }],
  );
  assert.equal(critical.effort, "xhigh");
  assert.deepEqual(critical.triggers, ["CRITICAL_FINDING"]);
});

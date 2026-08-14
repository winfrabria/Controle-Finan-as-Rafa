import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_POLICY, selectReasoningEffort } from "./policy";

test("mantém auditoria primária e recuperação em Terra high", () => {
  assert.equal(AUDIT_POLICY.version, "2026-08-14.2");
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

import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessInvoice } from "./contracts";
import { evaluateHarness } from "./engine";
import { evaluateUniversalRules, evaluateWorkRules } from "./rules";

function invoice(overrides: Partial<HarnessInvoice> = {}): HarnessInvoice {
  return {
    documentNumber: "123",
    supplierName: "Fornecedor",
    supplierTaxId: "11222333000181",
    issuedAt: "2026-07-10",
    totalAmount: "20.00",
    readConfidence: 0.95,
    warnings: [],
    markdown: "Cupom fiscal",
    items: [{ lineNumber: 1, description: "Parafuso", quantity: "2", unitPrice: "10.00", totalAmount: "20.00" }],
    ...overrides,
  };
}

test("álcool e higiene pessoal são sempre suspeitos", () => {
  for (const description of ["Cerveja lata 350ml", "Shampoo 400ml"]) {
    const result = evaluateHarness({ invoice: invoice({ items: [{ lineNumber: 1, description, quantity: "1", unitPrice: "20.00", totalAmount: "20.00" }] }) });
    assert.equal(result.classification, "SUSPICIOUS");
    assert.equal(result.findings.some((item) => item.category === "ALCOHOL" || item.category === "PERSONAL_HYGIENE"), true);
  }
});

test("detecta divergência do total e de quantidade vezes preço", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({ totalAmount: "30.00", items: [{ lineNumber: 1, description: "Cimento", quantity: "2", unitPrice: "10.00", totalAmount: "25.00" }] }),
  });
  assert.deepEqual(result.findings.map((item) => item.code).sort(), ["ITEM_ARITHMETIC_MISMATCH", "TOTAL_MISMATCH"]);
});

test("aplica regra da obra sem inventar configuração desconhecida", () => {
  const result = evaluateWorkRules(invoice(), [{
    code: "WORK-LIMIT", name: "Limite por nota", category: "BUDGET",
    severity: "WARNING", configuration: { maxTotalAmount: 10 },
  }]);
  assert.equal(result.covered, true);
  assert.equal(result.findings[0]?.code, "WORK-LIMIT_MAX_TOTAL");
  assert.equal(evaluateWorkRules(invoice(), [{
    code: "UNKNOWN", name: "Desconhecida", category: "OTHER",
    severity: "WARNING", configuration: { magic: true },
  }]).covered, false);
});


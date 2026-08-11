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

test("não soma NF-e, resumo e detalhamento diário como três despesas", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "1148.50",
      items: [
        {
          lineNumber: 1,
          description: "NF-e, página 1: CAFE DA MANHA.",
          quantity: "164.07",
          unitPrice: "7.00",
          totalAmount: "1148.50",
        },
        {
          lineNumber: 2,
          description: "Ficha de despesa, página 2: resumo do item CAFÉ DA MANHÃ.",
          quantity: "163",
          unitPrice: "7.00",
          totalAmount: "1141.00",
        },
        {
          lineNumber: 3,
          description: "Ficha de despesa, página 2: resumo do item LANCHE.",
          quantity: "1",
          unitPrice: "7.50",
          totalAmount: "7.50",
        },
        {
          lineNumber: 4,
          description: "Ficha diária, página 2: 01/07/2026 — café da manhã.",
          quantity: "6",
          unitPrice: "7.00",
          totalAmount: "42.00",
        },
        {
          lineNumber: 5,
          description: "Ficha diária, página 2: demais lançamentos do período.",
          quantity: null,
          unitPrice: null,
          totalAmount: "1106.50",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((item) => item.code === "TOTAL_MISMATCH"),
    false,
  );
});

test("usa somente a camada explicitamente marcada para reconciliar o total", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "1148.50",
      items: [
        {
          lineNumber: 1,
          description: "Linha fiscal",
          countsTowardDocumentTotal: true,
          quantity: "164.07",
          unitPrice: "7.00",
          totalAmount: "1148.50",
        },
        {
          lineNumber: 2,
          description: "Resumo de apoio",
          countsTowardDocumentTotal: false,
          quantity: "164",
          unitPrice: null,
          totalAmount: "1148.50",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((item) => item.code === "TOTAL_MISMATCH"),
    false,
  );
});

test("ignora diferenças residuais de arredondamento sem esconder divergências reais", () => {
  const rounding = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "11850.15",
      items: [{ lineNumber: 1, description: "Combustível", quantity: "1594.91", unitPrice: "7.43", totalAmount: "11850.15" }],
    }),
  });
  assert.equal(rounding.findings.some((item) => item.code === "ITEM_ARITHMETIC_MISMATCH"), false);

  const realMismatch = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "25.00",
      items: [{ lineNumber: 1, description: "Material", quantity: "2", unitPrice: "10.00", totalAmount: "25.00" }],
    }),
  });
  assert.equal(realMismatch.findings.some((item) => item.code === "ITEM_ARITHMETIC_MISMATCH"), true);
});

test("não sinaliza como erro aritmético um desconto explícito e reconciliado", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "12.00",
      items: [
        {
          lineNumber: 13,
          description: "3 itens de R$ 5,00 com desconto de R$ 3,00",
          quantity: "3",
          unitPrice: "5.00",
          totalAmount: "12.00",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((item) => item.code === "ITEM_ARITHMETIC_MISMATCH"),
    false,
  );
});

test("não suspeita apenas porque o comprovante é recibo, pedido ou orçamento", () => {
  for (const markdown of [
    "Recibo simples pago por PIX",
    "Pedido 99866 — valor pago R$ 25,00",
    "Orçamento quitado e entregue",
  ]) {
    const result = evaluateUniversalRules({ invoice: invoice({ markdown }) });
    assert.equal(
      result.findings.some((item) => item.category === "DOCUMENT_TYPE"),
      false,
    );
  }
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


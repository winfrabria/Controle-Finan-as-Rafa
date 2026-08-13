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

test("não inventa divergência de data ou valor no item 19 conciliado", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "551.90",
      items: [
        {
          lineNumber: 19,
          description: "Casa da Uva — lanche",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "18.00",
          totalAmount: "18.00",
          evidenceObservations: [
            {
              kind: "SHEET",
              label: "Ficha de reembolso",
              amount: "18.00",
              date: "2026-05-27",
              page: 1,
              text: "Item 19 — R$ 18,00",
            },
            {
              kind: "RECEIPT",
              label: "Recibo manuscrito",
              amount: "18.00",
              date: "2026-05-27",
              page: 20,
              text: "Lanche — R$ 18,00",
            },
            {
              kind: "PAYMENT",
              label: "Cartão Casa da Uva",
              amount: "18.00",
              date: "2026-05-27",
              page: 20,
              text: "Valor R$ 18,00",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code === "EVIDENCE_AMOUNT_MISMATCH_19" ||
        finding.code === "EVIDENCE_DATE_MISMATCH_19",
    ),
    false,
  );
});

test("reconcilia pagamento agregado com a soma dos produtos do mesmo documento", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "15.00",
      items: [
        {
          lineNumber: 23,
          description: "Pão de queijo",
          countsTowardDocumentTotal: true,
          quantity: "2",
          unitPrice: "5.00",
          totalAmount: "10.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "NFCE-75395", label: "Item 001", amount: "10.00", date: "2026-05-14", page: 3, text: "2 x R$ 5,00" },
            { kind: "PAYMENT", documentGroup: "NFCE-75395", label: "Pagamento total", amount: "15.00", date: "2026-05-14", page: 3, text: "Débito R$ 15,00" },
          ],
        },
        {
          lineNumber: 24,
          description: "Café expresso",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "5.00",
          totalAmount: "5.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "NFCE-75395", label: "Item 002", amount: "5.00", date: "2026-05-14", page: 3, text: "1 x R$ 5,00" },
            { kind: "PAYMENT", documentGroup: "NFCE-75395", label: "Pagamento total", amount: "15.00", date: "2026-05-14", page: 3, text: "Débito R$ 15,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_"),
    ),
    false,
  );
});

test("sinaliza uma vez quando pagamento agregado não reconcilia com os produtos", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "20.00",
      items: [
        {
          lineNumber: 1,
          description: "Produto A",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "10.00",
          totalAmount: "10.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "NFCE-X", label: "Item 1", amount: "10.00", date: null, page: 1, text: "Produto A" },
            { kind: "PAYMENT", documentGroup: "NFCE-X", label: "Pagamento", amount: "20.00", date: null, page: 1, text: "Pagamento total" },
          ],
        },
        {
          lineNumber: 2,
          description: "Produto B",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "5.00",
          totalAmount: "5.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "NFCE-X", label: "Item 2", amount: "5.00", date: null, page: 1, text: "Produto B" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.filter((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_"),
    ).length,
    1,
  );
});

test("sinaliza boleto agregado quando os documentos fiscais anexados não cobrem o pagamento", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      documentNumber: "3098",
      totalAmount: "2142.29",
      items: [
        {
          lineNumber: 1,
          description: "Boleto referente aos documentos 3055 A 3098",
          documentGroup: "LOTE-A",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "2142.29",
          totalAmount: "2142.29",
        },
        {
          lineNumber: 2,
          description: "NF-e 3098 — peças e materiais",
          documentGroup: "LOTE-A",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "473.93",
          totalAmount: "473.93",
        },
      ],
    }),
  });

  const gap = result.findings.find(
    (finding) => finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
  );
  assert.ok(gap);
  assert.equal(gap.expectedValue, "2142.29");
  assert.equal(gap.actualValue, "473.93");
  assert.equal(gap.evidence.unsupportedAmount, "1668.36");
});

test("aplica a conciliação documental a outro fornecedor, outra cobrança e outros valores", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      documentNumber: "FAT-88",
      totalAmount: "950.00",
      items: [
        {
          lineNumber: 1,
          description: "Cobrança mensal consolidada",
          documentGroup: "MEDICAO-JULHO",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "950.00",
          totalAmount: "950.00",
        },
        {
          lineNumber: 2,
          description: "Documento fiscal de suporte A-71",
          documentGroup: "MEDICAO-JULHO",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "300.00",
          totalAmount: "300.00",
        },
        {
          lineNumber: 3,
          description: "Documento fiscal de suporte A-72",
          documentGroup: "MEDICAO-JULHO",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "250.00",
          totalAmount: "250.00",
        },
      ],
    }),
  });

  const gap = result.findings.find((finding) =>
    finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
  );
  assert.ok(gap);
  assert.equal(gap.expectedValue, "950.00");
  assert.equal(gap.actualValue, "550.00");
  assert.equal(gap.evidence.unsupportedAmount, "400.00");
});

test("preserva o achado de cobertura e elimina o total genérico duplicado", () => {
  const result = evaluateHarness({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "950.00",
      items: [
        {
          lineNumber: 1,
          description: "Cobrança mensal consolidada",
          documentGroup: "MEDICAO-AGOSTO",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "950.00",
          totalAmount: "950.00",
        },
        {
          lineNumber: 2,
          description: "Documento fiscal de suporte B-10",
          documentGroup: "MEDICAO-AGOSTO",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "550.00",
          totalAmount: "550.00",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
    ),
    true,
  );
  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
  );
});

test("não sinaliza boleto agregado quando os documentos anexados cobrem o pagamento", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "823.00",
      items: [
        {
          lineNumber: 1,
          description: "Boleto referente à nota 6733",
          documentGroup: "LOTE-B",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "823.00",
          totalAmount: "823.00",
        },
        {
          lineNumber: 2,
          description: "NF-e 6733 — seis produtos",
          documentGroup: "LOTE-B",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "823.00",
          totalAmount: "823.00",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) => finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
    ),
    false,
  );
});

test("sinaliza campos vazios somente quando o documento declara obrigatoriedade", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      requiredFieldChecks: [
        {
          field: "approver",
          label: "Aprovador",
          requiredByDocument: true,
          present: false,
          page: 1,
          evidence: "O formulário informa que todos os campos são obrigatórios.",
        },
        {
          field: "requester_signature",
          label: "Assinatura do solicitante",
          requiredByDocument: true,
          present: true,
          page: 1,
          evidence: "Campo assinado.",
        },
        {
          field: "optional_note",
          label: "Observação opcional",
          requiredByDocument: false,
          present: false,
          page: 1,
          evidence: "Campo opcional vazio.",
        },
      ],
    }),
  });

  const missing = result.findings.find(
    (finding) => finding.code === "REQUIRED_DOCUMENT_FIELDS_MISSING",
  );
  assert.ok(missing);
  assert.match(missing.description, /Aprovador/);
  assert.doesNotMatch(missing.description, /Observação opcional/);
  assert.doesNotMatch(missing.description, /Assinatura do solicitante/);
});

test("não sinaliza campo vazio sem declaração explícita de obrigatoriedade", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      requiredFieldChecks: [
        {
          field: "signature",
          label: "Assinatura",
          requiredByDocument: false,
          present: false,
          page: 1,
          evidence: null,
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) => finding.code === "REQUIRED_DOCUMENT_FIELDS_MISSING",
    ),
    false,
  );
});

test("reconcilia datas internas como achado objetivo, não contexto", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      items: [
        {
          lineNumber: 8,
          description: "Restaurante Fazendinha",
          quantity: "1",
          unitPrice: "15.00",
          totalAmount: "15.00",
          evidenceObservations: [
            {
              kind: "SHEET",
              label: "Ficha",
              amount: "15.00",
              date: "2026-05-19",
              page: 9,
              text: "Data 19/05/2026",
            },
            {
              kind: "PAYMENT",
              label: "Pagamento",
              amount: "15.00",
              date: "2026-05-18",
              page: 9,
              text: "Pagamento 18/05/2026",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) => finding.code === "EVIDENCE_DATE_MISMATCH_8",
    ),
    true,
  );
});

test("desconto explícito que reconcilia venda e pagamento não vira divergência", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      items: [
        {
          lineNumber: 4,
          description: "Material com desconto explícito",
          quantity: "1",
          unitPrice: "42.60",
          totalAmount: "38.00",
          evidenceObservations: [
            {
              kind: "SALE",
              label: "Venda",
              amount: "42.60",
              date: "2026-05-11",
              page: 5,
              text: "Venda R$ 42,60",
            },
            {
              kind: "DISCOUNT",
              label: "Desconto",
              amount: "4.60",
              date: "2026-05-11",
              page: 5,
              text: "Desconto R$ 4,60",
            },
            {
              kind: "PAYMENT",
              label: "Pagamento",
              amount: "38.00",
              date: "2026-05-11",
              page: 5,
              text: "Pago R$ 38,00",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_"),
    ),
    false,
  );
});

test("NF-1359 sinaliza período incompatível sem inventar divergência na agregação fiscal", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      issuedAt: "2026-08-03",
      totalAmount: "1549.30",
      items: [
        {
          lineNumber: 1,
          description: "NF-e 1359 — LANCHE agregado; suporte: 193 cafés e 1 lanche",
          countsTowardDocumentTotal: true,
          quantity: "258.21",
          unitPrice: "6.00",
          totalAmount: "1549.26",
          evidenceObservations: [
            {
              kind: "SALE",
              label: "NF-e 1359",
              amount: "1549.30",
              date: "2026-08-03",
              page: 1,
              text: "Valor total R$ 1.549,30; emissão 03/08/2026",
            },
            {
              kind: "SHEET",
              label: "Controle operacional",
              amount: "1549.30",
              date: "2025-07-31",
              page: 2,
              text: "Período 19/07/2025 a 31/07/2025; total R$ 1.549,30",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) => finding.code === "EVIDENCE_DATE_MISMATCH_1",
    ),
    true,
  );
  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_"),
    ),
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


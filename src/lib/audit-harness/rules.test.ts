import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessInvoice } from "./contracts";
import { evaluateHarness } from "./engine";
import { evaluateUniversalRules, evaluateWorkRules } from "./rules";

function invoice(overrides: Partial<HarnessInvoice> = {}): HarnessInvoice {
  const merged: HarnessInvoice = {
    documentNumber: "123",
    supplierName: "Fornecedor",
    supplierTaxId: "11222333000181",
    issuedAt: "2026-07-10",
    totalAmount: "20.00",
    readConfidence: 0.95,
    warnings: [],
    markdown: "Cupom fiscal",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 1,
      extractedItemCount: 1,
      firstLineNumber: 1,
      lastLineNumber: 1,
      missingLineNumbers: [],
      evidence: "Camada fiscal integralmente conferida.",
    },
    items: [{ lineNumber: 1, description: "Parafuso", quantity: "2", unitPrice: "10.00", totalAmount: "20.00" }],
    ...overrides,
  };
  return {
    ...merged,
    items: merged.items.map((item) =>
      item.arithmeticVerified === undefined
        ? { ...item, arithmeticVerified: true }
        : item,
    ),
  };
}

test("álcool e higiene pessoal são sempre suspeitos", () => {
  for (const description of ["Cerveja lata 350ml", "Shampoo 400ml"]) {
    const result = evaluateHarness({ invoice: invoice({ items: [{ lineNumber: 1, description, quantity: "1", unitPrice: "20.00", totalAmount: "20.00" }] }) });
    assert.equal(result.classification, "SUSPICIOUS");
    assert.equal(result.findings.some((item) => item.category === "ALCOHOL" || item.category === "PERSONAL_HYGIENE"), true);
  }
});

test("cobertura parcial só confirma álcool ou higiene quando o item aparece", () => {
  const partial = evaluateUniversalRules({
    invoice: invoice({
      itemCoverage: {
        status: "INCOMPLETE",
        declaredItemCount: 3,
        extractedItemCount: 1,
        firstLineNumber: 1,
        lastLineNumber: 1,
        missingLineNumbers: [2, 3],
        evidence: "Somente a primeira linha foi extraída.",
      },
      items: [{
        lineNumber: 1,
        description: "Material de construção sintético",
        quantity: "1",
        unitPrice: "20.00",
        totalAmount: "20.00",
      }],
    }),
  });

  assert.equal(partial.coveredAreas.includes("ALCOHOL"), false);
  assert.equal(partial.coveredAreas.includes("PERSONAL_HYGIENE"), false);

  const positive = evaluateUniversalRules({
    invoice: invoice({
      itemCoverage: {
        status: "INCOMPLETE",
        declaredItemCount: 3,
        extractedItemCount: 1,
        firstLineNumber: 1,
        lastLineNumber: 1,
        missingLineNumbers: [2, 3],
        evidence: "Somente a primeira linha foi extraída.",
      },
      items: [{
        lineNumber: 1,
        description: "Cerveja sintética",
        quantity: "1",
        unitPrice: "20.00",
        totalAmount: "20.00",
      }],
    }),
  });

  assert.equal(positive.coveredAreas.includes("ALCOHOL"), true);
  assert.equal(positive.findings.some((finding) => finding.code === "ALCOHOL_ITEM"), true);
  assert.equal(positive.coveredAreas.includes("PERSONAL_HYGIENE"), false);
});

test("cobertura completa permite registrar ausência verificada nas categorias universais", () => {
  const complete = evaluateUniversalRules({ invoice: invoice() });
  assert.equal(complete.coveredAreas.includes("ALCOHOL"), true);
  assert.equal(complete.coveredAreas.includes("PERSONAL_HYGIENE"), true);
});

test("detecta divergência do total e de quantidade vezes preço", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({ totalAmount: "30.00", items: [{ lineNumber: 1, description: "Cimento", quantity: "2", unitPrice: "10.00", totalAmount: "25.00" }] }),
  });
  assert.deepEqual(result.findings.map((item) => item.code).sort(), ["ITEM_ARITHMETIC_MISMATCH", "TOTAL_MISMATCH"]);
});

test("não conclui divergência de total quando a cobertura de itens é desconhecida ou incompleta", () => {
  for (const status of ["UNKNOWN", "INCOMPLETE"] as const) {
    const result = evaluateUniversalRules({
      invoice: invoice({
        totalAmount: "1203.74",
        itemCoverage: {
          status,
          declaredItemCount: 50,
          extractedItemCount: 44,
          firstLineNumber: 1,
          lastLineNumber: 44,
          missingLineNumbers: [45, 46, 47, 48, 49, 50],
          evidence: "A extração terminou antes do fim da tabela.",
        },
        items: [
          {
            lineNumber: 1,
            description: "Camada fiscal parcial",
            countsTowardDocumentTotal: true,
            quantity: "1",
            unitPrice: "1087.29",
            totalAmount: "1087.29",
          },
        ],
      }),
    });

    assert.equal(
      result.findings.some((item) => item.code === "TOTAL_MISMATCH"),
      false,
    );
  }
});

test("cobertura COMPLETE com lacuna interna não autoriza divergência de total", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "100.00",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 2,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 3,
        missingLineNumbers: [],
        evidence: "Linhas 1 e 3 declaradas como completas.",
      },
      items: [
        { lineNumber: 1, description: "Item A", quantity: "1", unitPrice: "20.00", totalAmount: "20.00" },
        { lineNumber: 3, description: "Item C", quantity: "1", unitPrice: "20.00", totalAmount: "20.00" },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
  );
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

test("não inventa divergência de data ou valor em item sintético conciliado", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "180.00",
      items: [
        {
          lineNumber: 7,
          description: "Lanche sintético",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "18.00",
          totalAmount: "18.00",
          evidenceObservations: [
            {
              kind: "SHEET",
              label: "Ficha de reembolso",
              amount: "18.00",
              date: "2026-08-10",
              page: 2,
              text: "Item 7 — R$ 18,00",
            },
            {
              kind: "RECEIPT",
              label: "Recibo manuscrito",
              amount: "18.00",
              date: "2026-08-10",
              page: 3,
              text: "Lanche — R$ 18,00",
            },
            {
              kind: "PAYMENT",
              label: "Cartão sintético",
              amount: "18.00",
              date: "2026-08-10",
              page: 3,
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
        finding.code === "EVIDENCE_AMOUNT_MISMATCH_7" ||
        finding.code === "EVIDENCE_DATE_MISMATCH_7",
    ),
    false,
  );
});

test("não soma ficha, recibo e pagamento de R$ 20,00 como R$ 60,00", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "20.00",
      items: [
        {
          lineNumber: 1,
          description: "Despesa registrada na ficha",
          documentGroup: "evento-20",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "evento-20", label: "Ficha", amount: "20.00", date: "2026-05-19", page: 1, text: "R$ 20,00" },
          ],
        },
        {
          lineNumber: 2,
          description: "Pagamento da mesma despesa",
          documentGroup: "evento-20",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "evento-20", label: "Cartão", amount: "20.00", date: "2026-05-19", page: 2, text: "Débito R$ 20,00" },
          ],
        },
        {
          lineNumber: 3,
          description: "Recibo da mesma despesa",
          documentGroup: "evento-20",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "evento-20", label: "Recibo", amount: "20.00", date: "2026-05-19", page: 2, text: "Total R$ 20,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_") ||
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_")
    ),
    false,
  );
});

test("não soma três camadas de R$ 35,90 como R$ 107,70", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "35.90",
      items: [
        {
          lineNumber: 1,
          description: "Ficha da despesa",
          documentGroup: "evento-3590",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "35.90",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "evento-3590", label: "Ficha", amount: "35.90", date: "2026-05-15", page: 1, text: "R$ 35,90" },
          ],
        },
        {
          lineNumber: 2,
          description: "Pagamento da despesa",
          documentGroup: "evento-3590",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "35.90",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "evento-3590", label: "Cartão", amount: "35.90", date: "2026-05-15", page: 2, text: "R$ 35,90" },
          ],
        },
        {
          lineNumber: 3,
          description: "Venda da despesa",
          documentGroup: "evento-3590",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "35.90",
          evidenceObservations: [
            { kind: "SALE", documentGroup: "evento-3590", label: "Pedido", amount: "35.90", date: "2026-05-15", page: 2, text: "Total R$ 35,90" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_") ||
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_")
    ),
    false,
  );
});

test("valor contradizendo seu próprio trecho não acusa divergência financeira nem apaga a data", () => {
  const doc = invoice({ documentKind: "REIMBURSEMENT", items: [{ lineNumber: 1, description: "Despesa sintética",
    quantity: "1", unitPrice: "20", totalAmount: "20", countsTowardDocumentTotal: true,
    evidenceObservations: [
      { kind: "SHEET", amountScope: "ITEM_TOTAL", label: "Ficha", amount: "20.00", date: "2026-07-10", page: 1, text: "Total R$ 20,00" },
      { kind: "RECEIPT", amountScope: "ITEM_TOTAL", label: "Recibo", amount: "25.00", date: "2026-07-09", page: 2, text: "Total R$ 20,00" },
    ] }] });
  const findings = evaluateUniversalRules({ invoice: doc }).findings;
  assert.equal(findings.some((entry) => entry.code.startsWith("EVIDENCE_AMOUNT_MISMATCH")), false);
  assert.equal(findings.some((entry) => entry.code === "EVIDENCE_DATE_MISMATCH_1"), true);
  doc.items[0].evidenceObservations![1].text = "Total R$ 25,00";
  assert.equal(evaluateUniversalRules({ invoice: doc }).findings.some((entry) => entry.code === "EVIDENCE_AMOUNT_MISMATCH_1"), true);
});

test("não transforma provável erro de OCR aritmético em suspeita", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "1203.74",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 2,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 2,
        missingLineNumbers: [],
        evidence: "As duas linhas foram extraídas.",
      },
      items: [
        {
          lineNumber: 1,
          description: "Linha visualmente conciliada",
          countsTowardDocumentTotal: true,
          arithmeticVerified: true,
          quantity: "1",
          unitPrice: "1138.49",
          totalAmount: "1138.49",
        },
        {
          lineNumber: 2,
          description: "Linha com dígito incerto na leitura",
          countsTowardDocumentTotal: true,
          arithmeticVerified: false,
          quantity: "1.764",
          unitPrice: "36.9898",
          totalAmount: "85.25",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) => finding.code === "ITEM_ARITHMETIC_MISMATCH"),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
  );
  assert.equal(result.coveredAreas.includes("QUANTITY_TIMES_PRICE"), true);
});

test("linha tipada não publica data sem trecho, mas preserva a divergência monetária rastreável", () => {
  const doc = invoice({ documentKind: "REIMBURSEMENT", items: [{ lineNumber: 1, description: "Material",
    sourceKind: "SHEET", sourcePage: 1, sourceText: "01/06/2026 Material 20,00",
    quantity: null, unitPrice: null, totalAmount: "20.00",
    evidenceObservations: [
      { kind: "SHEET", amountScope: "ITEM_TOTAL", label: "Ficha", amount: "20.00", date: "2026-06-01", page: 1, text: "01/06/2026 Material 20,00" },
      { kind: "PAYMENT", amountScope: "ITEM_TOTAL", label: "Cartão", amount: "30.00", date: "2026-06-02", page: 2, text: "DEBITO R$ 30,00" },
    ] }] });
  const codes = () => evaluateUniversalRules({ invoice: doc }).findings.map(f => f.code);
  assert.equal(codes().includes("EVIDENCE_DATE_MISMATCH_1"), false);
  assert.equal(codes().includes("EVIDENCE_AMOUNT_MISMATCH_1"), true);
  doc.items[0].evidenceObservations![1].text = "02/06/2026 DEBITO R$ 30,00";
  assert.equal(codes().includes("EVIDENCE_DATE_MISMATCH_1"), true);
});

test("mantém divergência aritmética confirmada visualmente", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      totalAmount: "85.25",
      items: [
        {
          lineNumber: 1,
          description: "Linha conferida na origem",
          arithmeticVerified: true,
          quantity: "1.764",
          unitPrice: "36.9898",
          totalAmount: "85.25",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) => finding.code === "ITEM_ARITHMETIC_MISMATCH"),
    true,
  );
});

test("não combina quantidade de recibo com total líquido da ficha sem rastreio dos operandos", () => {
  const row = { lineNumber: 1, description: "Material", arithmeticVerified: true,
    sourceKind: "SHEET" as const, sourcePage: 1, sourceText: "01/06/2026 Material R$ 32,00",
    quantity: "6", unitPrice: "7.00", totalAmount: "32.00" };
  const result = evaluateUniversalRules({ invoice: invoice({ totalAmount: "32.00", items: [row] }) });
  assert.equal(result.findings.some(f => f.code === "ITEM_ARITHMETIC_MISMATCH"), false);
  assert.equal(result.coveredAreas.includes("QUANTITY_TIMES_PRICE"), false);
});

test("mantém erro aritmético com operandos localizados na mesma linha tipada", () => {
  const row = { lineNumber: 1, description: "Material", arithmeticVerified: true,
    sourceKind: "FISCAL_LINE" as const, sourcePage: 2, sourceText: "Material QTD 6 UN 7,00 TOTAL 32,00",
    quantity: "6", unitPrice: "7.00", totalAmount: "32.00" };
  assert.equal(evaluateUniversalRules({ invoice: invoice({ totalAmount: "32.00", items: [row] }) })
    .findings.some(f => f.code === "ITEM_ARITHMETIC_MISMATCH"), true);
});

test("desconto explícito no trecho da própria fonte reconcilia cálculo sem depender da descrição", () => {
  const row = { lineNumber: 1, description: "Material", arithmeticVerified: true,
    sourceKind: "FISCAL_LINE" as const, sourcePage: 2,
    sourceText: "Material QTD 6 UN 7,00 SUBTOTAL 42,00 DESCONTO 10,00 TOTAL 32,00",
    quantity: "6", unitPrice: "7.00", totalAmount: "32.00" };
  assert.equal(evaluateUniversalRules({ invoice: invoice({ totalAmount: "32.00", items: [row] }) })
    .findings.some(f => f.code === "ITEM_ARITHMETIC_MISMATCH"), false);
  row.sourceText = row.sourceText.replace("DESCONTO 10,00", "DESCONTO 2,00");
  assert.equal(evaluateUniversalRules({ invoice: invoice({ totalAmount: "32.00", items: [row] }) })
    .findings.some(f => f.code === "ITEM_ARITHMETIC_MISMATCH"), true);
});

test("desconto tipado da mesma linha reconcilia preço bruto com total líquido", () => {
  const row = { lineNumber: 52, description: "Bebida", arithmeticVerified: true,
    documentGroup: "NF-1", sourceKind: "FISCAL_LINE" as const, sourcePage: 3,
    sourceText: "Bebida 1 9,1900 1,20 7,99", quantity: "1", unitPrice: "9.19", totalAmount: "7.99",
    evidenceObservations: [{ kind: "DISCOUNT" as const, amountScope: "ADJUSTMENT" as const,
      documentGroup: "NF-1", label: null, amount: "1.20", date: null, page: 3,
      text: "Bebida 1 9,1900 1,20 7,99" }] };
  const hasMismatch = (value: typeof row) => evaluateUniversalRules({ invoice: invoice({ totalAmount: "7.99", items: [value] }) })
    .findings.some(finding => finding.code === "ITEM_ARITHMETIC_MISMATCH");
  assert.equal(hasMismatch(row), false);
  assert.equal(hasMismatch({ ...row, evidenceObservations: [{ ...row.evidenceObservations[0], amount: "0.20" }] }), true);
  assert.equal(hasMismatch({ ...row, evidenceObservations: [{ ...row.evidenceObservations[0], page: 2 }] }), true);
});

test("não compara total fiscal com resumo e linhas diárias sobrepostas", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "120.00",
      items: [
        {
          lineNumber: 1,
          description: "Linha fiscal consolidada",
          documentGroup: "pacote-sintetico",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "120.00",
          totalAmount: "120.00",
          evidenceObservations: [
            {
              kind: "RECEIPT",
              documentGroup: "pacote-sintetico",
              label: "Documento fiscal",
              amount: "120.00",
              date: "2026-06-02",
              page: 1,
              text: "Total fiscal R$ 120,00",
            },
          ],
        },
        {
          lineNumber: 2,
          description: "Resumo operacional A",
          documentGroup: "pacote-sintetico",
          documentRole: "SUMMARY",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "100.00",
          evidenceObservations: [
            {
              kind: "SHEET",
              documentGroup: "pacote-sintetico",
              label: "Resumo operacional",
              amount: "100.00",
              date: "2026-05-03",
              page: 2,
              text: "Resumo A R$ 100,00",
            },
          ],
        },
        {
          lineNumber: 3,
          description: "Resumo operacional B",
          documentGroup: "pacote-sintetico",
          documentRole: "SUMMARY",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            {
              kind: "SHEET",
              documentGroup: "pacote-sintetico",
              label: "Resumo operacional",
              amount: "20.00",
              date: "2026-05-03",
              page: 2,
              text: "Resumo B R$ 20,00",
            },
          ],
        },
        ...["2026-05-01", "2026-05-02", "2026-05-03"].map(
          (date, index) => ({
            lineNumber: index + 4,
            description: `Detalhamento diário ${index + 1}`,
            documentGroup: "pacote-sintetico",
            documentRole: "SUMMARY" as const,
            countsTowardDocumentTotal: false,
            quantity: null,
            unitPrice: null,
            totalAmount: "40.00",
            evidenceObservations: [
              {
                kind: "SHEET" as const,
                documentGroup: "pacote-sintetico",
                label: "Detalhamento diário",
                amount: "40.00",
                date,
                page: 2,
                text: `Linha diária ${index + 1}`,
              },
            ],
          }),
        ),
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
        finding.code.startsWith("EVIDENCE_DATE_MISMATCH_"),
    ),
    false,
  );
});

test("documento composto legado sem camada explícita não soma evidências sobrepostas", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "20.00",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 3,
        extractedItemCount: 3,
        firstLineNumber: 1,
        lastLineNumber: 3,
        missingLineNumbers: [],
        evidence: "Três camadas documentais extraídas.",
      },
      items: [
        {
          lineNumber: 1,
          description: "Ficha da despesa",
          documentGroup: "evento-legado",
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "evento-legado", label: "Ficha", amount: "20.00", date: "2026-05-19", page: 1, text: "R$ 20,00" },
          ],
        },
        {
          lineNumber: 2,
          description: "Recibo da mesma despesa",
          documentGroup: "evento-legado",
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "evento-legado", label: "Recibo", amount: "20.00", date: "2026-05-19", page: 2, text: "R$ 20,00" },
          ],
        },
        {
          lineNumber: 3,
          description: "Pagamento da mesma despesa",
          documentGroup: "evento-legado",
          quantity: null,
          unitPrice: null,
          totalAmount: "20.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "evento-legado", label: "Cartão", amount: "20.00", date: "2026-05-19", page: 2, text: "R$ 20,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code === "TOTAL_MISMATCH" ||
        finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_"),
    ),
    false,
  );
});

test("ficha legada classificada como nota fiscal não soma camadas sobrepostas", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "FISCAL_INVOICE",
      markdown: "Ficha de reembolso com recibo e comprovante de pagamento.",
      totalAmount: "20.00",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 3,
        extractedItemCount: 3,
        firstLineNumber: 1,
        lastLineNumber: 3,
        missingLineNumbers: [],
        evidence: "Três linhas extraídas.",
      },
      items: [1, 2, 3].map((lineNumber) => ({
        lineNumber,
        description: `Camada ${lineNumber}`,
        quantity: null,
        unitPrice: null,
        totalAmount: "20.00",
      })),
    }),
  });

  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
  );
});

test("gera um único achado para divergência real de R$ 18,00 e R$ 28,00", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "18.00",
      items: [
        {
          lineNumber: 19,
          description: "Despesa registrada na ficha",
          documentGroup: "evento-divergente",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "18.00",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "evento-divergente", label: "Ficha", amount: "18.00", date: "2026-05-27", page: 1, text: "R$ 18,00" },
          ],
        },
        {
          lineNumber: 20,
          description: "Comprovante de pagamento",
          documentGroup: "evento-divergente",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "28.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "evento-divergente", label: "Débito", amount: "28.00", date: "2026-05-27", page: 2, text: "R$ 28,00" },
          ],
        },
        {
          lineNumber: 21,
          description: "Recibo da despesa",
          documentGroup: "evento-divergente",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "18.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "evento-divergente", label: "Recibo", amount: "18.00", date: "2026-05-27", page: 2, text: "R$ 18,00" },
          ],
        },
      ],
    }),
  });

  const amountFindings = result.findings.filter((finding) =>
    finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
    finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_")
  );
  assert.equal(amountFindings.length, 1);
  assert.equal(amountFindings[0]?.code, "EVIDENCE_AMOUNT_MISMATCH_19");
  assert.equal(amountFindings[0]?.expectedValue, "18.00");
  assert.equal(amountFindings[0]?.actualValue, "28.00");
});

test("compara a linha primária da venda com ficha e pagamento do mesmo evento", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "40.00",
      items: [
        {
          lineNumber: 12,
          description: "Despesa na ficha",
          documentGroup: "evento-item-12",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "40.00",
          sourceKind: "SHEET",
          sourceDate: "2026-05-21",
          sourcePage: 1,
          sourceText: "12 21/05/2026 RECIBO R$ 40,00",
          evidenceObservations: [
            { kind: "SHEET", amountScope: "ITEM_TOTAL", documentGroup: "evento-item-12", label: "Ficha", amount: "40.00", date: "2026-05-21", page: 1, text: "12 21/05/2026 RECIBO R$ 40,00" },
          ],
        },
        {
          lineNumber: 36,
          description: "TRENA LUFKIN 8M C/ TRAVA",
          documentGroup: "evento-item-12",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "44.50",
          totalAmount: "44.50",
          sourceKind: "SALE",
          sourceDate: "2026-05-21",
          sourcePage: 13,
          sourceText: "TRENA Qtde 1 Preço 44,50 Total 44,50 21/05/2026",
          evidenceObservations: [
            { kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", documentGroup: "evento-item-12", label: "Pagamento", amount: "40.00", date: "2026-05-21", page: 13, text: "Débito R$ 40,00 21/05/2026" },
          ],
        },
      ],
    }),
  });

  const findings = result.findings.filter((finding) => finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.comparisonMode, "REFERENCE");
  assert.equal(findings[0]?.expectedValue, "40.00");
  assert.equal(findings[0]?.actualValue, "44.50");
  assert.deepEqual(
    (findings[0]?.evidence.observations as Array<{ kind: string }>).map((observation) => observation.kind),
    ["SHEET", "SALE", "PAYMENT"],
  );
});

test("reconcilia o mesmo total transacional mesmo com escopos ITEM_TOTAL e DOCUMENT_TOTAL", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "18.00",
      items: [{
        lineNumber: 19,
        description: "Despesa 19",
        documentGroup: "evento-item-19",
        documentRole: "LINE_ITEM",
        countsTowardDocumentTotal: true,
        quantity: null,
        unitPrice: null,
        totalAmount: "18.00",
        evidenceObservations: [
          { kind: "SHEET", amountScope: "ITEM_TOTAL", documentGroup: "evento-item-19", label: "Ficha", amount: "18.00", date: null, page: 1, text: "Ficha R$ 18,00" },
          { kind: "RECEIPT", amountScope: "DOCUMENT_TOTAL", documentGroup: "evento-item-19", label: "Recibo", amount: "18.00", date: null, page: 20, text: "Recibo R$ 18,00" },
          { kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", documentGroup: "evento-item-19", label: "Pagamento", amount: "28.00", date: null, page: 20, text: "Débito R$ 28,00" },
        ],
      }],
    }),
  });
  const finding = result.findings.find((entry) => entry.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_19"));
  assert.equal(finding?.expectedValue, "18.00");
  assert.equal(finding?.actualValue, "28.00");
  assert.equal(finding?.code, "EVIDENCE_AMOUNT_MISMATCH_19");
});

test("desconto explícito reconcilia as camadas do mesmo evento", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "38.00",
      items: [
        {
          lineNumber: 1,
          description: "Ficha da despesa",
          documentGroup: "evento-desconto",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "38.00",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "evento-desconto", label: "Ficha", amount: "38.00", date: "2026-05-21", page: 1, text: "R$ 38,00" },
          ],
        },
        {
          lineNumber: 2,
          description: "Venda com desconto",
          documentGroup: "evento-desconto",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "38.00",
          evidenceObservations: [
            { kind: "SALE", documentGroup: "evento-desconto", label: "Venda", amount: "42.60", date: "2026-05-21", page: 2, text: "Soma R$ 42,60" },
            { kind: "DISCOUNT", documentGroup: "evento-desconto", label: "Desconto", amount: "4.60", date: "2026-05-21", page: 2, text: "Desconto R$ 4,60" },
          ],
        },
        {
          lineNumber: 3,
          description: "Pagamento líquido",
          documentGroup: "evento-desconto",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "38.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "evento-desconto", label: "Pagamento", amount: "38.00", date: "2026-05-21", page: 2, text: "Pago R$ 38,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_")
    ),
    false,
  );
});

test("suporte sem observação não altera a reconciliação do evento", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      totalAmount: "10.00",
      items: [
        {
          lineNumber: 1,
          description: "Ficha da despesa",
          documentGroup: "evento-sem-observacao",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "10.00",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "evento-sem-observacao", label: "Ficha", amount: "10.00", date: "2026-05-19", page: 1, text: "R$ 10,00" },
          ],
        },
        {
          lineNumber: 2,
          description: "Pagamento da despesa",
          documentGroup: "evento-sem-observacao",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "10.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "evento-sem-observacao", label: "Pagamento", amount: "10.00", date: "2026-05-19", page: 2, text: "R$ 10,00" },
          ],
        },
        {
          lineNumber: 3,
          description: "Documento de venda sem observação estruturada",
          documentGroup: "evento-sem-observacao",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "10.00",
          evidenceObservations: [],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_")
    ),
    false,
  );
});

test("preserva cobrança agregada explícita com linhas econômicas independentes", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "100.00",
      items: [
        {
          lineNumber: 1,
          description: "Cobrança consolidada",
          documentGroup: "lote-explicito",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: null,
          unitPrice: null,
          totalAmount: "100.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "lote-explicito", label: "Cobrança", amount: "100.00", date: "2026-05-31", page: 1, text: "R$ 100,00" },
          ],
        },
        {
          lineNumber: 2,
          description: "Documento econômico A",
          documentGroup: "lote-explicito",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "60.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "lote-explicito", label: "Documento A", amount: "60.00", date: "2026-05-30", page: 2, text: "R$ 60,00" },
          ],
        },
        {
          lineNumber: 3,
          description: "Documento econômico B",
          documentGroup: "lote-explicito",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: null,
          unitPrice: null,
          totalAmount: "40.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "lote-explicito", label: "Documento B", amount: "40.00", date: "2026-05-30", page: 3, text: "R$ 40,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_")
    ),
    false,
  );
});

test("suporte marcado como não econômico não é somado ao pagamento agregado", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "100.00",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 3,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 2,
        missingLineNumbers: [],
        evidence: "Duas linhas econômicas selecionadas; uma camada de apoio excluída.",
      },
      items: [
        {
          lineNumber: 1,
          description: "Cobrança agregada",
          documentGroup: "lote-cem",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "100.00",
          totalAmount: "100.00",
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "lote-cem", label: "Pagamento", amount: "100.00", date: null, page: 1, text: "R$ 100,00" },
          ],
        },
        {
          lineNumber: 2,
          description: "Linha econômica",
          documentGroup: "lote-cem",
          documentRole: "LINE_ITEM",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "100.00",
          totalAmount: "100.00",
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "lote-cem", label: "Item", amount: "100.00", date: null, page: 2, text: "R$ 100,00" },
          ],
        },
        {
          lineNumber: 3,
          description: "Cópia de apoio da linha econômica",
          documentGroup: "lote-cem",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "100.00",
          totalAmount: "100.00",
          evidenceObservations: [
            { kind: "SHEET", documentGroup: "lote-cem", label: "Apoio", amount: "100.00", date: null, page: 3, text: "R$ 100,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_"),
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

test("não presume se pagamentos estruturalmente idênticos são parcelas ou repetição da extração", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      totalAmount: "100.00",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 2,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 2,
        missingLineNumbers: [],
        evidence: "Duas linhas integralmente extraídas.",
      },
      items: [1, 2].map((lineNumber) => ({
        lineNumber,
        description: `Documento de suporte ${lineNumber}`,
        documentRole: "SUPPORTING_DOCUMENT" as const,
        documentGroup: "grupo-sintetico",
        countsTowardDocumentTotal: true,
        quantity: "1",
        unitPrice: "50.00",
        totalAmount: "50.00",
        evidenceObservations: [
          {
            kind: "PAYMENT" as const,
            documentGroup: "grupo-sintetico",
            label: "Pagamento sem identificador de parcela",
            amount: "50.00",
            date: "2026-07-10",
            page: 1,
            text: "Pagamento de R$ 50,00",
          },
        ],
      })),
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_"),
    ),
    false,
    "sem identidade de instância, não é seguro concluir que existe apenas uma parcela",
  );
  const limitation = result.findings.find((finding) =>
    finding.code.startsWith("AGGREGATE_PAYMENT_INSTANCE_AMBIGUITY_"),
  );
  assert.ok(
    limitation,
    "a incerteza deve permanecer registrada como limitação informativa",
  );
  assert.equal(limitation.severity, "INFO");
  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
  );
  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_") ||
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_"),
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

test("não trata suportes ausentes do boleto como irregularidade comprovada", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      documentNumber: "LOTE-SINTETICO",
      totalAmount: "900.00",
      items: [
        {
          lineNumber: 1,
          description: "Cobrança agregada referente a múltiplos documentos",
          documentGroup: "LOTE-A",
          documentRole: "AGGREGATE_PAYMENT",
          countsTowardDocumentTotal: true,
          quantity: "1",
          unitPrice: "900.00",
          totalAmount: "900.00",
        },
        {
          lineNumber: 2,
          description: "Documento fiscal de suporte parcial",
          documentGroup: "LOTE-A",
          documentRole: "SUPPORTING_DOCUMENT",
          countsTowardDocumentTotal: false,
          quantity: "1",
          unitPrice: "350.00",
          totalAmount: "350.00",
        },
      ],
    }),
  });

  const gap = result.findings.find(
    (finding) => finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
  );
  assert.equal(gap, undefined);
});

test("não inventa conciliação documental para outro conjunto parcial", () => {
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
          evidenceObservations: [
            { kind: "PAYMENT", documentGroup: "MEDICAO-AGOSTO", label: "Cobrança", amount: "950.00", date: null, page: 1, text: "R$ 950,00" },
          ],
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
  assert.equal(gap, undefined);
});

test("ausência de suporte não cria card nem total genérico duplicado", () => {
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
          evidenceObservations: [
            { kind: "RECEIPT", documentGroup: "MEDICAO-AGOSTO", label: "Documento fiscal", amount: "550.00", date: null, page: 2, text: "R$ 550,00" },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
    ),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
  );
  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH_") ||
      finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_"),
    ),
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
          requirementBasis: "EXPLICIT_DOCUMENT",
          requirementEvidence: "O formulário informa que todos os campos são obrigatórios.",
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
  assert.match(missing.references[0] ?? "", /^DOCUMENTO:/);
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
          lineNumber: 4,
          description: "Despesa sintética de alimentação",
          quantity: "1",
          unitPrice: "15.00",
          totalAmount: "15.00",
          evidenceObservations: [
            {
              kind: "SHEET",
              label: "Ficha",
              amount: "15.00",
              date: "2026-08-11",
              page: 4,
              text: "Data 11/08/2026",
            },
            {
              kind: "PAYMENT",
              label: "Pagamento",
              amount: "15.00",
              date: "2026-08-10",
              page: 4,
              text: "Pagamento 10/08/2026",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) => finding.code === "EVIDENCE_DATE_MISMATCH_4",
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

test("não transforma área visivelmente vazia em campo obrigatório", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "REIMBURSEMENT",
      requiredFieldChecks: [
        {
          field: "approver",
          label: "Aprovador",
          requiredByDocument: true,
          requirementBasis: "NONE",
          requirementEvidence: null,
          present: false,
          page: 1,
          evidence: "A área está visivelmente vazia.",
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

test("não usa evidência legada sem requirementBasis para sustentar suspeita", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      requiredFieldChecks: [
        {
          field: "approver",
          label: "Aprovador",
          requiredByDocument: true,
          present: false,
          page: 1,
          evidence: "O formulário informa que todos os campos são obrigatórios.",
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

test("aceita política verificada como base explícita de obrigatoriedade", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      requiredFieldChecks: [
        {
          field: "authorization",
          label: "Autorização",
          requiredByDocument: true,
          requirementBasis: "VERIFIED_POLICY",
          requirementEvidence: "Política global POL-001 exige autorização.",
          present: false,
          page: 1,
          evidence: "Campo sem preenchimento.",
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) => finding.code === "REQUIRED_DOCUMENT_FIELDS_MISSING",
    ),
    true,
  );
  const missing = result.findings.find(
    (finding) => finding.code === "REQUIRED_DOCUMENT_FIELDS_MISSING",
  );
  assert.ok(missing);
  assert.match(missing.description, /política global verificada/i);
  assert.doesNotMatch(missing.description, /o próprio documento/i);
  assert.match(missing.justification, /política global verificada/i);
  assert.match(missing.references[0] ?? "", /^POLITICA_VERIFICADA:/);
});

test("não compara valor do boleto com multa ou encargo do próprio boleto", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      items: [
        {
          lineNumber: 1,
          description: "Cobrança sintética",
          quantity: "1",
          unitPrice: "1203.74",
          totalAmount: "1203.74",
          evidenceObservations: [
            {
              kind: "OTHER",
              documentGroup: "cobranca-a",
              label: "Valor do documento",
              amount: "1203.74",
              date: "2026-08-06",
              page: 1,
              text: "Valor do documento R$ 1.203,74",
            },
            {
              kind: "OTHER",
              documentGroup: "cobranca-a",
              label: "Multa após vencimento",
              amount: "24.08",
              date: "2026-08-17",
              page: 1,
              text: "Multa de 2% após o vencimento: R$ 24,08",
            },
          ],
        },
      ],
    }),
  });

  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
        finding.code.startsWith("EVIDENCE_DATE_MISMATCH_"),
    ),
    false,
  );
});

test("não compara emissão, vencimento e datas diárias como se fossem o mesmo campo", () => {
  const result = evaluateUniversalRules({
    invoice: invoice({
      documentKind: "COMPOSITE",
      items: [
        {
          lineNumber: 1,
          description: "Documento composto sintético",
          quantity: "1",
          unitPrice: "100.00",
          totalAmount: "100.00",
          evidenceObservations: [
            {
              kind: "OTHER",
              documentGroup: "pacote-a",
              label: "Data de emissão",
              amount: null,
              date: "2026-06-02",
              page: 1,
              text: "Documento emitido em 02/06/2026",
            },
            {
              kind: "OTHER",
              documentGroup: "pacote-a",
              label: "Vencimento",
              amount: null,
              date: "2026-06-15",
              page: 1,
              text: "Vencimento 15/06/2026",
            },
            {
              kind: "SHEET",
              documentGroup: "pacote-a",
              label: "Controle diário",
              amount: null,
              date: "2026-05-03",
              page: 2,
              text: "Despesa em 03/05/2026",
            },
            {
              kind: "SHEET",
              documentGroup: "pacote-a",
              label: "Controle diário",
              amount: null,
              date: "2026-05-04",
              page: 2,
              text: "Despesa em 04/05/2026",
            },
          ],
        },
      ],
    }),
  });

  const dateFinding = result.findings.find(
    (finding) => finding.code === "EVIDENCE_DATE_MISMATCH_1",
  );
  assert.equal(dateFinding, undefined);
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

test("diagnostica regra inválida sem expor sua configuração", () => {
  const result = evaluateWorkRules(invoice(), [
    {
      code: "WORK-INVALID",
      name: "Regra sintética inválida",
      category: "WORK",
      severity: "WARNING",
      configuration: {
        maxTotalAmount: "segredo-que-nao-deve-ser-retornado",
      },
    },
  ]);

  assert.deepEqual(result.invalidRules, [
    { code: "WORK-INVALID", issuePaths: ["maxTotalAmount"] },
  ]);
  assert.doesNotMatch(JSON.stringify(result.invalidRules), /segredo/);
  assert.equal(result.covered, false);
});


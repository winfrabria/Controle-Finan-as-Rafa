import assert from "node:assert/strict";
import test from "node:test";

import type { NoteDetailFinding } from "./data";
import { buildReviewerMobileComparison } from "./reviewer-mobile-comparison";
import { buildFindingComparison } from "./finding-comparison";
import { findingDocumentPageUrl } from "./finding-observations";

function finding(overrides: Partial<NoteDetailFinding>): NoteDetailFinding {
  return {
    actualValue: null,
    affectedItem: null,
    category: "AMOUNTS",
    code: "EVIDENCE_AMOUNT_MISMATCH",
    comparisonMode: "CONFLICT",
    createdAt: new Date("2026-08-30T12:00:00Z"),
    description: "Os valores encontrados divergem entre as fontes.",
    evidence: null,
    explanation: "As fontes apresentaram valores diferentes.",
    expectedValue: null,
    id: "finding-test",
    needsValidation: true,
    referenceBasis: null,
    rule: null,
    severity: "WARNING",
    sources: [],
    status: "OPEN",
    title: "Valores divergentes no mesmo comprovante",
    updatedAt: new Date("2026-08-30T12:00:00Z"),
    ...overrides,
  };
}

test("resumo textual dos mesmos valores não inventa uma terceira fonte", () => {
  const input = finding({ actualValue: "Recibo R$ 72,00 vs Débito R$ 82,00", evidence: {
    field: "totalAmount", observations: [
      { kind: "RECEIPT", label: "Recibo", value: "72.00", page: 2 },
      { kind: "PAYMENT", label: "Débito", value: "82.00", page: 2 },
    ],
  } });
  assert.equal(buildFindingComparison(input).cards.length, 2);
  assert.equal(buildFindingComparison({ ...input, actualValue: "Recibo R$ 72,00 vs Débito R$ 83,00" }).cards.length, 3);
});

test("conflito de especificação usa encontrado e esperado sem inventar terceira fonte", () => {
  const input = finding({ category: "PRODUCT", code: "PRODUCT_DESCRIPTION_MISMATCH", title: "Descrições diferentes",
    actualValue: "NF-e especifica Óleo Diesel S-10, enquanto o controle registra Óleo Diesel S500",
    evidence: { field: "descrição do produto", observations: [
      { kind: "FISCAL_LINE", label: "Nota fiscal", value: "OLEO DIESEL S-10", page: 3 },
      { kind: "SHEET", label: "Ficha", value: "DIESEL S500", page: 5 },
    ] } });
  const expected = [
    { label: "Encontrado", lines: ["OLEO DIESEL S-10"], tone: "actual" },
    { label: "Esperado", lines: ["DIESEL S500"], tone: "expected" },
  ];
  assert.deepEqual(buildFindingComparison(input).cards, expected);
  assert.deepEqual(buildReviewerMobileComparison(input).cards, expected);
  assert.deepEqual(buildFindingComparison({ ...input, actualValue: "Resumo extenso. ".repeat(40) }).cards, expected);
  assert.equal(buildFindingComparison({ ...input, evidence: { ...input.evidence as object, observations: [
    ...((input.evidence as { observations: object[] }).observations),
    { kind: "RECEIPT", label: "Recibo", value: "DIESEL S10 ADITIVADO", page: 4 },
  ] } }).cards.length, 3);
});

test("detalhamento parcial legado não transforma cálculos derivados em referência", () => {
  const comparison = buildFindingComparison(finding({
    actualValue: ["1498.00", "161.00"],
    code: "DOCUMENT_BREAKDOWN_MISMATCH_2",
    evidence: {
      comparisonMode: "CONFLICT",
      comparisonValues: [
        { label: "Total declarado", value: "1498.00" },
        { label: "Soma bruta do detalhamento", value: "161.00" },
        { label: "Detalhamento líquido", value: "161.00" },
      ],
      observations: [
        { amount: "1498.00", kind: "SHEET", label: "Resumo", page: 2 },
        { amount: "56.00", kind: "SHEET", label: "Dia 1", page: 2 },
        { amount: "56.00", kind: "SHEET", label: "Dia 2", page: 2 },
        { amount: "49.00", kind: "SHEET", label: "Dia 3", page: 2 },
      ],
      requiresSourceReview: true,
    },
  }));

  assert.equal(comparison.mode, "CONFLICT");
  assert.deepEqual(
    comparison.cards.map((card) => card.label),
    ["Total declarado", "Soma bruta do detalhamento / Detalhamento líquido"],
  );
  assert.equal(comparison.difference, null);
});

test("descrição legada sem duas observações mantém os valores disponíveis", () => {
  const input = finding({ category: "PRODUCT", code: "PRODUCT_DESCRIPTION_MISMATCH", title: "Descrições diferentes",
    actualValue: "Tipo A", expectedValue: "Tipo B", evidence: { field: "descrição" } });
  assert.equal(buildFindingComparison(input).cards.length, 2);
  assert.equal(buildFindingComparison({ ...input, evidence: { field: "descrição", observations: [
    { kind: "SHEET", label: "Ficha", value: "Tipo A", page: 1 },
    { kind: "RECEIPT", label: "Recibo", page: 2 },
  ] } }).cards.length, 2);
});

test("desktop e mobile usam os valores originais, sem fabricar soma de fontes", () => {
  const input = finding({ actualValue: ["507.00", "500.00", "7.00"], evidence: {
    observations: [
      { kind: "RECEIPT", amount: "507.00", page: 1, label: "Nota fiscal", text: "Serviço 507" },
      { kind: "SHEET", amount: "500.00", page: 2, label: "Controle", text: "Componente A 500" },
      { kind: "SHEET", amount: "7.00", page: 2, label: "Controle", text: "Componente B 7" },
    ],
  } });
  const desktop = buildFindingComparison(input);
  assert.deepEqual(desktop, buildReviewerMobileComparison(input));
  assert.equal(desktop.cards.length, 3);
  assert.equal(desktop.cards[0].label, "Nota fiscal");
  assert.equal(desktop.cards.some((card) => card.label.includes("encontrado")), false);
});

test("comparação calculada usa total contra soma, mantendo componentes nas evidências", () => {
  const input = finding({ actualValue: ["509.00", "507.00"], evidence: {
    comparisonValues: [{ label: "Total declarado", value: "509.00" }, { label: "Soma do detalhamento", value: "507.00" }],
    observations: [{ kind: "SHEET", amount: "500.00" }, { kind: "SHEET", amount: "7.00" }],
  } });
  const comparison = buildFindingComparison(input);
  assert.deepEqual(comparison.cards.map((card) => card.label), ["Total declarado", "Soma do detalhamento"]);
  assert.equal(comparison.cards.length, 2);
});

test("cada página tem link próprio sem perder a consulta e sem aceitar protocolo executável", () => {
  const url = "https://example.test/document.pdf?key=test#page=1";
  assert.equal(findingDocumentPageUrl(url, 13), "https://example.test/document.pdf?key=test#page=13");
  assert.equal(findingDocumentPageUrl(url, -1), "https://example.test/document.pdf?key=test");
  assert.equal(findingDocumentPageUrl(null, 1), null);
  assert.equal(findingDocumentPageUrl("javascript:alert(1)", 1), null);
});

test("contrato mobile apresenta item12 como encontrado versus referência corroborada", () => {
  const comparison = buildReviewerMobileComparison(
    finding({
      actualValue: ["40.00", "44.50"],
      code: "EVIDENCE_AMOUNT_MISMATCH_12",
      evidence: {
        boundingBox: [10, 20, 30, 40],
        documentRole: "supporting_document",
        observations: [
          {
            amount: "40.00",
            kind: "SHEET",
            label: "Ficha",
            page: 1,
            text: "Ficha R$ 40,00",
          },
          {
            amount: "40.00",
            kind: "PAYMENT",
            label: "Pagamento",
            page: 2,
            text: "Débito R$ 40,00",
          },
          {
            amount: "44.50",
            kind: "SALE",
            label: "Venda",
            page: 2,
            text: "Total da venda R$ 44,50",
          },
        ],
        requirementBasis: "VERIFIED_POLICY",
      },
      expectedValue: null,
    }),
  );

  assert.equal(comparison.mode, "REFERENCE");
  assert.deepEqual(comparison.cards, [
    {
      label: "Encontrado",
      lines: ["R$\u00a044,50"],
      tone: "actual",
    },
    {
      label: "Esperado",
      lines: ["R$\u00a040,00"],
      tone: "expected",
    },
  ]);
  assert.equal(comparison.difference, "R$\u00a04,50");
  assert.equal(comparison.hint, null);
  assert.doesNotMatch(
    JSON.stringify(comparison),
    /documentRole|boundingBox|requirementBasis|referência usada/i,
  );
  assert.deepEqual(comparison.cards.map((card) => card.tone), ["actual", "expected"]);
});

test("achados legados da HWN também usam encontrado e esperado", () => {
  const salePayment = buildReviewerMobileComparison(
    finding({
      actualValue: "44.50 vs 40.00",
      code: "SALE_PAYMENT_MISMATCH_ITEM_12",
      evidence: {
        observations: [
          { kind: "SALE", label: "Venda ou pedido", page: 13, value: "44.50" },
          { kind: "PAYMENT", label: "Pagamento", page: 13, value: "40.00" },
        ],
      },
    }),
  );
  assert.deepEqual(salePayment.cards, [
    { label: "Encontrado", lines: ["R$\u00a044,50"], tone: "actual" },
    { label: "Esperado", lines: ["R$\u00a040,00"], tone: "expected" },
  ]);
  assert.equal(salePayment.difference, "R$\u00a04,50");

  const receiptPayment = buildReviewerMobileComparison(
    finding({
      actualValue: ["18.00", "28.00"],
      code: "EVIDENCE_AMOUNT_MISMATCH_19_DOCUMENT_TOTAL",
      evidence: {
        observations: [
          { amount: "18.00", kind: "RECEIPT", label: "Recibo", page: 20 },
          { amount: "28.00", kind: "PAYMENT", label: "Pagamento", page: 20 },
        ],
      },
    }),
  );
  assert.deepEqual(receiptPayment.cards, [
    { label: "Encontrado", lines: ["R$\u00a028,00"], tone: "actual" },
    { label: "Esperado", lines: ["R$\u00a018,00"], tone: "expected" },
  ]);
  assert.equal(receiptPayment.difference, "R$\u00a010,00");

  const date = buildReviewerMobileComparison(
    finding({
      actualValue: ["2026-05-19", "2026-05-18"],
      category: "DATES",
      code: "EVIDENCE_DATE_MISMATCH_8",
      evidence: {
        observations: [
          { date: "2026-05-19", kind: "SHEET", label: "Ficha", page: 1 },
          { date: "2026-05-18", kind: "PAYMENT", label: "Pagamento", page: 9 },
        ],
      },
    }),
  );
  assert.deepEqual(date.cards, [
    { label: "Encontrado", lines: ["19/05/2026"], tone: "actual" },
    { label: "Esperado", lines: ["18/05/2026"], tone: "expected" },
  ]);
  assert.equal(date.difference, "1 dia");
});

test("contrato mobile mantém item19 como encontrado versus referência", () => {
  const comparison = buildReviewerMobileComparison(
    finding({
      actualValue: "28.00",
      code: "EVIDENCE_AMOUNT_MISMATCH_19",
      comparisonMode: "REFERENCE",
      evidence: {
        observations: [
          { amount: "18.00", kind: "SHEET", label: "Ficha", page: 1 },
          { amount: "18.00", kind: "RECEIPT", label: "Recibo", page: 2 },
          { amount: "28.00", kind: "PAYMENT", label: "Pagamento", page: 2 },
        ],
      },
      expectedValue: "18.00",
      referenceBasis: "CORROBORATED_SHEET_AND_RECEIPT",
    }),
  );

  assert.equal(comparison.mode, "REFERENCE");
  assert.deepEqual(comparison.cards, [
    {
      label: "Encontrado",
      lines: ["R$\u00a028,00"],
      tone: "actual",
    },
    {
      label: "Esperado",
      lines: ["R$\u00a018,00"],
      tone: "expected",
    },
  ]);
  assert.equal(comparison.hint, null);
  assert.equal(comparison.difference, "R$\u00a010,00");
  assert.doesNotMatch(JSON.stringify(comparison), /documentRole|boundingBox|requirementBasis/i);
});

test("contrato mobile escolhe datas quando a observação também traz valor", () => {
  const comparison = buildReviewerMobileComparison(
    finding({
      actualValue: ["2026-05-18", "2026-05-19"],
      category: "DATES",
      code: "EVIDENCE_DATE_MISMATCH_7",
      evidence: {
        observations: [
          {
            amount: "40.00",
            date: "2026-05-18",
            kind: "SHEET",
            label: "Ficha",
            page: 1,
          },
          {
            amount: "44.50",
            date: "2026-05-19",
            kind: "PAYMENT",
            label: "Pagamento",
            page: 2,
          },
        ],
      },
    }),
  );

  assert.deepEqual(comparison.cards, [
    {
      label: "Encontrado",
      lines: ["18/05/2026"],
      tone: "actual",
    },
    {
      label: "Esperado",
      lines: ["19/05/2026"],
      tone: "expected",
    },
  ]);
  assert.equal(comparison.difference, "1 dia");
  assert.equal(JSON.stringify(comparison).includes("R$"), false);
});

test("contrato mobile não atribui valor sem fonte ao cartão de outra fonte", () => {
  const comparison = buildReviewerMobileComparison(
    finding({
      actualValue: ["40.00", "44.50"],
      evidence: {
        observations: [
          {
            amount: null,
            kind: "SHEET",
            label: "Ficha",
            page: 1,
          },
          {
            amount: "44.50",
            kind: "PAYMENT",
            label: "Pagamento",
            page: 2,
          },
        ],
      },
    }),
  );

  assert.deepEqual(comparison.cards, [
    {
      label: "Pagamento",
      lines: ["R$\u00a044,50"],
      tone: "neutral",
    },
    {
      label: "Valor encontrado 1",
      lines: ["R$\u00a040,00"],
      tone: "neutral",
    },
  ]);
});

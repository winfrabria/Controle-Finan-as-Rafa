import assert from "node:assert/strict";
import test from "node:test";

import type { NoteDetailFinding } from "./data";
import { buildReviewerMobileComparison } from "./reviewer-mobile-comparison";

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

test("contrato mobile mantém item12 como conflito neutro por valor e fonte", () => {
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

  assert.equal(comparison.mode, "CONFLICT");
  assert.deepEqual(comparison.cards, [
    {
      label: "Ficha / Pagamento",
      lines: ["R$\u00a040,00"],
      tone: "neutral",
    },
    {
      label: "Venda ou pedido",
      lines: ["R$\u00a044,50"],
      tone: "neutral",
    },
  ]);
  assert.equal(comparison.difference, null);
  assert.equal(
    comparison.hint,
    "Sem referência comprovada para escolher um valor como correto.",
  );
  assert.doesNotMatch(
    JSON.stringify(comparison),
    /documentRole|boundingBox|requirementBasis|esperado|referência usada/i,
  );
  assert.ok(comparison.cards.every((card) => card.tone === "neutral"));
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
      label: "Valor encontrado",
      lines: ["R$\u00a028,00"],
      tone: "actual",
    },
    {
      label: "Valor de referência",
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
      label: "Ficha",
      lines: ["18/05/2026"],
      tone: "neutral",
    },
    {
      label: "Pagamento",
      lines: ["19/05/2026"],
      tone: "neutral",
    },
  ]);
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

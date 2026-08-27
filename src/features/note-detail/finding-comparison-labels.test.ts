import assert from "node:assert/strict";
import test from "node:test";

import type { NoteDetailFinding } from "./data";
import {
  findingComparisonDifference,
  findingComparisonLabels,
} from "./finding-comparison-labels";
import { summarizeFindingEvidenceObservations } from "./finding-observations";

type FindingInput = Parameters<typeof findingComparisonLabels>[0];

function finding(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    actualValue: null,
    affectedItem: null,
    category: "GERAL",
    code: "GENERIC_CHECK",
    evidence: null,
    expectedValue: null,
    rule: null,
    title: "Conferência geral",
    ...overrides,
  };
}

test("uses semantic labels for contract item-presence findings", () => {
  const labels = findingComparisonLabels(
    finding({
      actualValue: { item: "Material B", previstoNoContrato: false },
      affectedItem: {
        code: "B",
        description: "Material B",
        id: "item-b",
        lineNumber: 2,
      },
      category: "CONTRATO",
      code: "ITEM_FORA_CONTRATO",
      expectedValue: { itemEsperadoNoContrato: true },
      rule: {
        code: "CONTRATO_ITEM",
        description: "Compara os itens com a referência contratual.",
        id: "rule-contract-item",
        name: "Item previsto no contrato",
      },
      title: "Item não previsto no contrato",
    }),
  );

  assert.deepEqual(labels, {
    actual: "Item encontrado na nota",
    expected: "Item previsto no contrato",
  });
});

test("recognizes contract item checks from nested evidence structure", () => {
  const labels = findingComparisonLabels(
    finding({
      actualValue: { itemNota: "Material encontrado" },
      evidence: { contrato: { itemAutorizado: false } },
      expectedValue: { itemPrevisto: true },
      title: "Conferência de material",
    }),
  );

  assert.deepEqual(labels, {
    actual: "Item encontrado na nota",
    expected: "Item previsto no contrato",
  });
});

test("keeps generic labels for quantified contract findings", () => {
  const labels = findingComparisonLabels(
    finding({
      actualValue: { quantidadeEncontrada: 14 },
      affectedItem: {
        code: null,
        description: "Material genérico",
        id: "item-generic",
        lineNumber: 1,
      },
      category: "CONTRATO",
      code: "QUANTIDADE_ACIMA_CONTRATO",
      expectedValue: { quantidadeMaxima: 10 },
      title: "Quantidade acima do limite contratual",
    }),
  );

  assert.deepEqual(labels, {
    actual: "Encontrado",
    expected: "Esperado / referência",
  });
});

test("keeps generic labels for value and price comparisons without document roles", () => {
  for (const input of [
    finding({ category: "VALOR", code: "VALOR_DIVERGENTE" }),
    finding({ category: "PRECO", code: "PRECO_ACIMA_REFERENCIA" }),
  ]) {
    assert.deepEqual(findingComparisonLabels(input), {
      actual: "Encontrado",
      expected: "Esperado / referência",
    });
  }
});

test("explica a origem da referência nos cálculos determinísticos", () => {
  assert.deepEqual(
    findingComparisonLabels(
      finding({ code: "TOTAL_MISMATCH", category: "TOTALS" }),
    ),
    {
      actual: "Total encontrado no documento",
      expected: "Soma calculada dos itens",
    },
  );
  assert.deepEqual(
    findingComparisonLabels(
      finding({
        code: "ITEM_ARITHMETIC_MISMATCH",
        category: "QUANTITY_TIMES_PRICE",
      }),
    ),
    {
      actual: "Total encontrado no item",
      expected: "Quantidade × valor unitário",
    },
  );
});

test("uses document roles for payment, date and fiscal-sheet comparisons", () => {
  assert.deepEqual(
    findingComparisonLabels(
      finding({
        category: "VALOR",
        code: "PAYMENT_VALUE_MISMATCH",
        evidence: {
          observations: [
            { kind: "SHEET" },
            { kind: "RECEIPT" },
            { kind: "PAYMENT" },
          ],
        },
      }),
    ),
    { actual: "Pagamento", expected: "Ficha / venda ou recibo" },
  );

  assert.deepEqual(
    findingComparisonLabels(
      finding({
        category: "DATA",
        code: "TRANSACTION_DATE_MISMATCH",
        evidence: {
          observations: [{ kind: "SHEET" }, { kind: "PAYMENT" }],
        },
      }),
    ),
    { actual: "Data do comprovante", expected: "Data da ficha" },
  );

  assert.deepEqual(
    findingComparisonLabels(
      finding({
        category: "COMPOSICAO",
        code: "FISCAL_SHEET_COMPOSITION_MISMATCH",
        title: "Composição da ficha diverge da nota fiscal",
      }),
    ),
    { actual: "Ficha", expected: "Nota fiscal" },
  );
});

test("não chama comparação monetária de data só porque as evidências têm datas", () => {
  assert.deepEqual(
    findingComparisonLabels(
      finding({
        category: "AMOUNTS",
        code: "EVIDENCE_AMOUNT_MISMATCH_1",
        evidence: {
          field: "valor",
          observations: [
            { kind: "RECEIPT", date: "2026-06-02" },
            { kind: "SHEET", date: "2026-05-03" },
          ],
        },
      }),
    ),
    { actual: "Valor encontrado", expected: "Valor de referência" },
  );
});

test("agrupa linhas repetidas de evidência sem perder período ou total", () => {
  const summaries = summarizeFindingEvidenceObservations([
    {
      amount: "20.00",
      date: "2026-05-01",
      kind: "SHEET",
      label: "Café da manhã",
      page: 2,
      text: "Linha diária 1",
    },
    {
      amount: "30.00",
      date: "2026-05-02",
      kind: "SHEET",
      label: "Café da manhã",
      page: 2,
      text: "Linha diária 2",
    },
    {
      amount: "50.00",
      date: "2026-06-02",
      kind: "RECEIPT",
      label: "Documento fiscal",
      page: 1,
      text: "Total fiscal R$ 50,00",
    },
  ]);

  assert.equal(summaries.length, 2);
  assert.deepEqual(
    {
      count: summaries[0]?.count,
      firstDate: summaries[0]?.firstDate,
      lastDate: summaries[0]?.lastDate,
      totalAmount: summaries[0]?.totalAmount,
    },
    {
      count: 2,
      firstDate: "2026-05-01",
      lastDate: "2026-05-02",
      totalAmount: 50,
    },
  );
  assert.equal(summaries[1]?.count, 1);
});

test("shows the monetary difference when both compared values are objective", () => {
  assert.equal(
    findingComparisonDifference(
      finding({
        actualValue: "40.00",
        category: "VALOR",
        code: "PAYMENT_VALUE_MISMATCH",
        expectedValue: "44.50",
      }),
    ),
    "R$\u00a04,50",
  );
  assert.equal(
    findingComparisonDifference(
      finding({
        actualValue: "2026-05-18",
        category: "DATA",
        code: "TRANSACTION_DATE_MISMATCH",
        expectedValue: "2026-05-19",
      }),
    ),
    null,
  );
});

test("labels depend on structural fields rather than finding values", () => {
  const base = finding({
    actualValue: { item: "Material X", previstoNoContrato: false },
    category: "CONTRATO",
    code: "ITEM_FORA_CONTRATO",
    expectedValue: { itemEsperadoNoContrato: true },
  });

  const first = findingComparisonLabels(base);
  const second = findingComparisonLabels({
    ...base,
    actualValue: { item: "Material Y", previstoNoContrato: false },
  } as Pick<
    NoteDetailFinding,
    | "actualValue"
    | "affectedItem"
    | "category"
    | "code"
    | "evidence"
    | "expectedValue"
    | "rule"
    | "title"
  >);

  assert.deepEqual(first, second);
});

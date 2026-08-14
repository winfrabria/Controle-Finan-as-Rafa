import assert from "node:assert/strict";
import test from "node:test";

import {
  compactFindingFieldPath,
  formatFindingParts,
  formatReviewerFindingParts,
  formatFindingValueLines,
  formatFindingValue,
  humanizeFindingText,
} from "./finding-display";

test("resume caminhos longos de evidência para leitura rápida", () => {
  assert.equal(
    compactFindingFieldPath(
      "Itens › item 2 › Quantidade • Itens › item 2 › Valor unitário; Itens › item 3 › Valor total",
    ),
    "Itens 2 e 3 • Quantidade, Valor unitário, Valor total",
  );
});

test("formata valores monetários dos achados sem perder a fonte", () => {
  const value = formatFindingValue({
    amount: "18900.00",
    source: "Histórico da Obra 02",
  });

  assert.match(value, /R\$\u00a018\.900,00/);
  assert.match(value, /Fonte: Histórico da Obra 02/);
  assert.equal(formatFindingValue("18900.00"), "R$\u00a018.900,00");
  assert.equal(formatFindingValue({ amount: "1.500" }), "Valor: R$\u00a01.500,00");
});

test("traduz a conciliação de boleto agregado sem expor chaves técnicas", () => {
  assert.deepEqual(
    formatFindingParts({
      aggregateTotal: "2142.29",
      supportingTotal: "473.93",
      unsupportedAmount: "1668.36",
      supportingDocumentCount: 1,
    }),
    [
      { label: "Valor cobrado", value: "R$\u00a02.142,29" },
      { label: "Valor comprovado", value: "R$\u00a0473,93" },
      { label: "Valor sem documento no anexo", value: "R$\u00a01.668,36" },
      { label: "Documentos encontrados", value: "1" },
    ],
  );
});

test("mostra evidência textual sem expor as chaves do JSON", () => {
  const value = formatFindingValue({
    text: "R$ 18.900,00 contra referência média de R$ 15.500,00.",
  });

  assert.equal(value, "R$ 18.900,00 contra referência média de R$ 15.500,00.");
  assert.doesNotMatch(value, /text|\{|\}/i);
});

test("não trata quantidade ou identificador como moeda", () => {
  const value = formatFindingValue({
    item: "Kit de parafusos",
    quantity: "1500",
  });

  assert.equal(value, "Item: Kit de parafusos · Quantidade: 1500");
  assert.doesNotMatch(value, /R\$/);
});

test("traduz localização técnica da evidência para rótulos amigáveis", () => {
  const parts = formatFindingParts({
    page: 3,
    field: "items[0].totalAmount",
    excerpt: "TOTAL GERAL R$ 44,50",
  });

  assert.deepEqual(parts, [
    { label: "Página", value: "3" },
    { label: "Campo", value: "Itens › item 1 › Valor total" },
    { label: "Trecho do documento", value: "TOTAL GERAL R$ 44,50" },
  ]);
});

test("apresenta lineNumber como item e não como linha visual", () => {
  assert.deepEqual(formatFindingParts({ lineNumber: 19, page: 20 }), [
    { label: "Item", value: "19" },
    { label: "Página", value: "20" },
  ]);
});

test("traduz múltiplos campos e a fonte técnica da extração", () => {
  const parts = formatFindingParts({
    field: "items[0].quantity, items[0].unitPrice",
    source: "invoice.markdown",
    summary: "A quantidade diverge do detalhamento.",
  });

  assert.deepEqual(parts, [
    {
      label: "Campo",
      value: "Itens › item 1 › Quantidade • Itens › item 1 › Valor unitário",
    },
    { label: "Fonte", value: "Conteúdo extraído do documento" },
    { label: "Resumo da evidência", value: "A quantidade diverge do detalhamento." },
  ]);
});

test("traduz chaves técnicas que aparecem dentro da explicação da IA", () => {
  assert.equal(
    humanizeFindingText(
      "A extração preenche supplierName, supplierTaxId, issuedAt e total_amount.",
    ),
    "A extração preenche fornecedor, CNPJ do fornecedor, data de emissão e valor total.",
  );
});

test("separa comparações compostas em linhas legíveis", () => {
  assert.deepEqual(
    formatFindingValueLines(
      "Total da nota: R$ 44,50 · Quantidade: 2\nFornecedor: Mercado Central",
    ),
    [
      "Total da nota: R$ 44,50",
      "Quantidade: 2",
      "Fornecedor: Mercado Central",
    ],
  );
});

test("formata a conciliação financeira para o revisor sem detalhes internos", () => {
  assert.deepEqual(
    formatReviewerFindingParts({
      noteTotal: "1203.74",
      tolerance: "0.12",
      itemTotalSum: "1087.29",
      reconciliationBasis: "EXPLICIT_NON_OVERLAPPING_LAYER",
    }),
    [
      { label: "Total do documento", value: "R$\u00a01.203,74" },
      { label: "Soma dos itens considerados", value: "R$\u00a01.087,29" },
    ],
  );
});

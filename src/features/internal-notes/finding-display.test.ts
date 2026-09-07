import assert from "node:assert/strict";
import test from "node:test";

import {
  compactFindingFieldPath,
  findingComparisonMetadata,
  formatReviewerConflictValueCards,
  formatReviewerConflictValueLines,
  formatFindingParts,
  formatReviewerFindingParts,
  formatReviewerFindingValueLines,
  formatFindingValueLines,
  formatFindingValue,
  humanizeFindingText,
  humanizeReviewerFindingText,
  reviewerFindingValueDimension,
  reviewerObservationValue,
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
      aggregateTotal: "900.00",
      supportingTotal: "350.00",
      unsupportedAmount: "550.00",
      supportingDocumentCount: 1,
    }),
    [
      { label: "Valor cobrado", value: "R$\u00a0900,00" },
      { label: "Valor comprovado", value: "R$\u00a0350,00" },
      { label: "Valor sem documento no anexo", value: "R$\u00a0550,00" },
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

test("resume listas extensas de valores em vez de criar um card infinito", () => {
  assert.deepEqual(
    formatFindingValueLines(
      "10.00 × 20.00 × 30.00 × 40.00 × 50.00 × 60.00 × 70.00",
    ),
    [
      "10.00",
      "20.00",
      "30.00",
      "40.00",
      "Mais 3 valores no documento",
    ],
  );
});

test("formata datas ISO nas comparações para leitura humana", () => {
  assert.deepEqual(
    formatFindingValueLines(
      "2026-05-03 × 2026-05-04 a 2026-05-31 (28 datas)",
    ),
    ["03/05/2026", "04/05/2026 a 31/05/2026 (28 datas)"],
  );
});

test("resume campos obrigatórios vazios com contagem e dois exemplos", () => {
  assert.deepEqual(
    formatReviewerFindingValueLines(
      "Aprovador, Motivo, Ficha Nº, Assinatura do Solicitante, Assinatura do Financeiro, Assinatura do Aprovador",
      {
        code: "REQUIRED_FIELDS_EMPTY",
        title: "Campos obrigatórios não foram preenchidos",
      },
    ),
    [
      "6 campos obrigatórios vazios",
      "Exemplos: Aprovador e Motivo",
    ],
  );
});

test("limita prosa longa em comparação sem ocultar o detalhe bruto", () => {
  const [line] = formatReviewerFindingValueLines("x".repeat(220));
  assert.equal(line.length, 150);
  assert.match(line, /…$/u);
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

test("oculta grupo documental interno apenas na apresentação do revisor", () => {
  const evidence = {
    documentGroup: "D08",
    observations: [{ kind: "SHEET", amount: "15.00" }],
    summary: "Ficha e comprovante pertencem ao documento relacionado D08.",
  };

  assert.deepEqual(formatReviewerFindingParts(evidence), [
    {
      label: "Resumo da evidência",
      value: "Ficha e comprovante pertencem ao documento relacionado D08.",
    },
  ]);
  assert.ok(
    formatFindingParts(evidence).some(
      (part) => part.label === "Documento relacionado" && part.value === "D08",
    ),
  );
  assert.equal(
    humanizeReviewerFindingText(
      "Ficha e comprovante pertencem ao documento relacionado D08.",
    ),
    "Ficha e comprovante pertencem aos documentos da mesma despesa.",
  );
});

test("resume campos obrigatórios e remove metadados técnicos da evidência", () => {
  const parts = formatReviewerFindingParts({
    comparisonMode: "REFERENCE",
    documentRole: "supporting_document",
    fields: [
      {
        boundingBox: [1, 2, 3, 4],
        label: "Ficha de Reemb. Nº",
        requirementBasis: "EXPLICIT_DOCUMENT",
      },
      {
        label: "Tel. Solicitante",
        requirementEvidence: "O preenchimento é obrigatório.",
      },
      { label: "Aprovador" },
    ],
    referenceBasis: "DOCUMENT_POLICY",
  });

  assert.deepEqual(parts, [
    {
      label: "Campos não preenchidos",
      value:
        "3 campos obrigatórios vazios. Exemplos: Ficha de Reemb. Nº e Tel. Solicitante.",
    },
  ]);
});

test("resolve conflito sem referência e preserva referência explícita", () => {
  assert.deepEqual(findingComparisonMetadata({}, null), {
    comparisonMode: "CONFLICT",
    referenceBasis: null,
  });
  assert.deepEqual(findingComparisonMetadata({}, "44.50"), {
    comparisonMode: "CONFLICT",
    referenceBasis: null,
  });
  assert.deepEqual(
    findingComparisonMetadata(
      {
        fields: [
          {
            label: "Aprovador",
            requirementBasis: "EXPLICIT_DOCUMENT",
          },
        ],
      },
      "Campos obrigatórios preenchidos",
    ),
    {
      comparisonMode: "REFERENCE",
      referenceBasis: "EXPLICIT_DOCUMENT",
    },
  );
  assert.deepEqual(
    findingComparisonMetadata(
      {
        comparisonMode: "REFERENCE",
        referenceBasis: "CORROBORATED_SHEET_AND_RECEIPT",
      },
      "18.00",
    ),
    {
      comparisonMode: "REFERENCE",
      referenceBasis: "CORROBORATED_SHEET_AND_RECEIPT",
    },
  );
});

test("mostra todos os valores legados de um conflito sem inventar referência", () => {
  assert.deepEqual(
    formatReviewerConflictValueLines("40.00 × 40.00", "44.50", {
      category: "AMOUNTS",
      code: "EVIDENCE_AMOUNT_MISMATCH_12",
    }),
    ["R$\u00a040,00", "R$\u00a044,50"],
  );
});

test("separa conflito em cartões neutros e preserva a fonte observada", () => {
  assert.deepEqual(
    formatReviewerConflictValueCards(
      ["40.00"],
      "44.50",
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
      [
        { label: "Ficha", value: "40.00" },
        { label: "Pagamento", value: "44.50" },
      ],
    ),
    [
      { label: "Ficha", lines: ["R$\u00a040,00"] },
      { label: "Pagamento", lines: ["R$\u00a044,50"] },
    ],
  );
});

test("localiza valor numérico agregado no cartão da fonte sem perder moeda", () => {
  assert.deepEqual(
    formatReviewerConflictValueCards(
      ["40.00"],
      null,
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
      [{ label: "Ficha", value: 40 }],
    ),
    [{ label: "Ficha", lines: ["R$\u00a040,00"] }],
  );
});

test("agrupa fontes que confirmam o mesmo valor sem criar cartões repetidos", () => {
  assert.deepEqual(
    formatReviewerConflictValueCards(
      ["40.00", "44.50"],
      null,
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
      [
        { label: "Ficha", value: "40.00" },
        { label: "Pagamento", value: "40.00" },
        { label: "Venda ou pedido", value: "44.50" },
      ],
    ),
    [
      { label: "Ficha / Pagamento", lines: ["R$\u00a040,00"] },
      { label: "Venda ou pedido", lines: ["R$\u00a044,50"] },
    ],
  );
});

test("usa rótulos neutros quando o conflito legado não informa a fonte", () => {
  assert.deepEqual(
    formatReviewerConflictValueCards(
      "R$ 40,00 × R$ 44,50",
      null,
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
    ),
    [
      { label: "Valor encontrado 1", lines: ["R$\u00a040,00"] },
      { label: "Valor encontrado 2", lines: ["R$\u00a044,50"] },
    ],
  );
});

test("ignora placeholders legados em vez de mostrá-los como valor encontrado", () => {
  assert.deepEqual(
    formatReviewerConflictValueCards(
      "40.00",
      "Sem referência comparável",
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
    ),
    [{ label: "Valor encontrado 1", lines: ["R$\u00a040,00"] }],
  );
});

test("escolhe a dimensão sem misturar data e valor da mesma observação", () => {
  const identity = {
    category: "DATES",
    code: "EVIDENCE_DATE_MISMATCH_7",
    title: "Datas divergentes",
  };

  assert.equal(reviewerFindingValueDimension(identity), "date");
  assert.equal(
    reviewerObservationValue(
      { amount: "40.00", date: "2026-05-18" },
      identity,
    ),
    "2026-05-18",
  );
  assert.deepEqual(
    formatReviewerConflictValueCards(
      ["2026-05-18", "2026-05-19"],
      null,
      identity,
      [
        { label: "Ficha", value: "2026-05-18" },
        { label: "Pagamento", value: "2026-05-19" },
      ],
    ),
    [
      { label: "Ficha", lines: ["18/05/2026"] },
      { label: "Pagamento", lines: ["19/05/2026"] },
    ],
  );
});

test("não herda fallback de valor para fonte sem a dimensão observada", () => {
  assert.deepEqual(
    formatReviewerConflictValueCards(
      ["40.00", "44.50"],
      null,
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
      [
        { label: "Ficha" },
        { label: "Pagamento", value: "44.50" },
      ],
    ),
    [
      { label: "Pagamento", lines: ["R$\u00a044,50"] },
      { label: "Valor encontrado 1", lines: ["R$\u00a040,00"] },
    ],
  );
});

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
  inferReviewerDirectedComparison,
  isFindingLocationPart,
  reviewerComparisonDifferenceText,
  reviewerFindingValueDimension,
  reviewerObservationValue,
  reviewerConflictEvidencePreview,
} from "./finding-display";

test("localização preserva o registro extraído separado do item impresso e das observações", () => {
  const evidence = { page: 3, field: "totalAmount", item: 7, lineNumber: 12, excerpt: "Item 7 — Total 84,00" };
  for (const format of [formatFindingParts, formatReviewerFindingParts]) {
    const parts = format(evidence);
    const location = parts.filter(isFindingLocationPart);
    assert.deepEqual(location.map((part) => part.label), ["Página", "Campo", "Item", "Registro extraído"]);
    assert.equal(location.find((part) => part.label === "Item")?.value, "7");
    assert.equal(location.find((part) => part.label === "Registro extraído")?.value, "12");
    assert.equal(parts.filter((part) => !isFindingLocationPart(part)).length, 1);
  }
});

test("resumo das evidências destaca o valor divergente sem alterar as fontes", () => {
  const sources = [{ value: "83.00", label: "Ficha" }, { value: "R$ 83,00", label: "Recibo" }, { value: "85.00", label: "Pagamento" }];
  const before = structuredClone(sources);
  assert.deepEqual(reviewerConflictEvidencePreview(sources, { category: "AMOUNT" }), [sources[0], sources[2]]);
  assert.deepEqual(sources, before);
});

test("resumo sem valor comparável mantém a ordem original", () => {
  const sources = [{ value: null }, { value: null }, { value: null }];
  assert.deepEqual(reviewerConflictEvidencePreview(sources), sources.slice(0, 2));
});

test("resumo de datas não escolhe duas representações do mesmo dia", () => {
  const sources = [{ value: "2026-01-10" }, { value: "10/01/2026" }, { value: "2026-01-11" }];
  assert.deepEqual(reviewerConflictEvidencePreview(sources, { category: "DATE" }), [sources[0], sources[2]]);
  assert.equal(humanizeFindingText("sourceDate"), "Data do documento");
});

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

test("índice da extração não se apresenta como número impresso do item no documento", () => {
  assert.deepEqual(formatFindingParts({ lineNumber: 19, page: 20 }), [
    { label: "Registro extraído", value: "19" },
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

test("traduz identificadores de evidência sem inventar referência contratual", () => {
  assert.equal(humanizeReviewerFindingText("FISCAL_LINE"), "Item da nota fiscal");
  assert.equal(humanizeReviewerFindingText("FILE_SHA256"), "Arquivo idêntico");
  assert.equal(humanizeReviewerFindingText("ENVIO_UNICO_POR_SOLICITACAO"), "Um envio por solicitação");
  assert.deepEqual(formatReviewerFindingParts({ matchBasis: "FILE_SHA256" }),
    [{ label: "Como identificamos", value: "Arquivo idêntico" }]);
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
  const cards = formatReviewerConflictValueCards(
      ["40.00", "44.50"],
      null,
      { category: "AMOUNTS", code: "EVIDENCE_AMOUNT_MISMATCH_12" },
      [
        { label: "Ficha", value: "40.00" },
        { label: "Pagamento", value: "40.00" },
        { label: "Venda ou pedido", value: "44.50" },
      ],
    );
  assert.deepEqual(cards, [
      { label: "Ficha / Pagamento", lines: ["R$\u00a040,00"] },
      { label: "Venda ou pedido", lines: ["R$\u00a044,50"] },
    ]);
  const directed = inferReviewerDirectedComparison(cards, {
    category: "AMOUNTS",
    code: "EVIDENCE_AMOUNT_MISMATCH_12",
  });
  assert.deepEqual(directed, {
    actual: { label: "Venda ou pedido", lines: ["R$\u00a044,50"] },
    difference: "R$\u00a04,50",
    expected: { label: "Ficha / Pagamento", lines: ["R$\u00a040,00"] },
  });
  assert.equal(
    reviewerComparisonDifferenceText(directed?.difference ?? null, {
      category: "AMOUNTS",
    }),
    "Os valores divergem em R$\u00a04,50.",
  );
});

test("orienta conflitos legados somente quando o tipo das fontes define os lados", () => {
  const receiptPayment = inferReviewerDirectedComparison(
    [
      { label: "Recibo", lines: ["R$\u00a018,00"] },
      { label: "Pagamento", lines: ["R$\u00a028,00"] },
    ],
    { category: "AMOUNTS", code: "RECEIPT_PAYMENT_MISMATCH_ITEM_48" },
  );
  assert.equal(receiptPayment?.actual.lines[0], "R$\u00a028,00");
  assert.equal(receiptPayment?.expected.lines[0], "R$\u00a018,00");
  assert.equal(receiptPayment?.difference, "R$\u00a010,00");

  const date = inferReviewerDirectedComparison(
    [
      { label: "Ficha", lines: ["19/05/2026"] },
      { label: "Pagamento", lines: ["18/05/2026"] },
    ],
    { category: "DATES", code: "EVIDENCE_DATE_MISMATCH_8" },
  );
  assert.equal(date?.actual.lines[0], "19/05/2026");
  assert.equal(date?.expected.lines[0], "18/05/2026");
  assert.equal(date?.difference, "1 dia");
  assert.equal(
    reviewerComparisonDifferenceText(date?.difference ?? null, { category: "DATES" }),
    "As datas divergem em 1 dia.",
  );

  assert.equal(
    inferReviewerDirectedComparison(
      [
        { label: "Fonte A", lines: ["R$\u00a018,00"] },
        { label: "Fonte B", lines: ["R$\u00a028,00"] },
      ],
      { category: "AMOUNTS", code: "GENERIC_CONFLICT" },
    ),
    null,
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

test("lista de datas serializada não cria terceiro card repetindo as duas fontes", () => {
  for (const value of ["2026-08-04, 2026-08-03", "04/08/2026; 03/08/2026"]) {
    assert.deepEqual(formatReviewerConflictValueCards(value, null, { category: "DATES" }, [
      { label: "Ficha", value: "2026-08-04" }, { label: "Recibo", value: "2026-08-03" },
    ]), [
      { label: "Ficha", lines: ["04/08/2026"] }, { label: "Recibo", lines: ["03/08/2026"] },
    ]);
  }
});

test("data adicional sem fonte continua visível sem ser atribuída a um recibo", () => {
  assert.deepEqual(formatReviewerConflictValueCards("2026-08-04, 2026-08-03, 2026-08-02", null,
    { category: "DATES" }, [{ label: "Ficha", value: "2026-08-04" }, { label: "Recibo", value: "2026-08-03" }]), [
    { label: "Ficha", lines: ["04/08/2026"] }, { label: "Recibo", lines: ["03/08/2026"] },
    { label: "Data encontrada 1", lines: ["02/08/2026"] },
  ]);
});

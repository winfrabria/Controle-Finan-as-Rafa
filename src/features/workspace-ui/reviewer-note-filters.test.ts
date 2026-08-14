import assert from "node:assert/strict";
import test from "node:test";

import type { NoteVisualItem } from "./note-types";
import { filterReviewerNoteRows } from "./reviewer-note-filters";

function item(overrides: Partial<NoteVisualItem> = {}): NoteVisualItem {
  return {
    classification: "OK",
    date: "09/08/2026",
    id: "note-1",
    isRead: false,
    number: "ANX-0001",
    supplier: "Fornecedor A",
    value: "R$ 10,00",
    version: 1,
    work: "Obra 01",
    responsible: "Naldo",
    ...overrides,
  };
}

const rows = [
  { displayDate: "09/08/2026", item: item(), status: "OK" },
  {
    displayDate: "15/07/2026",
    item: item({ id: "note-2", number: "ANX-0002", supplier: "Fornecedor B" }),
    status: "Suspeita",
  },
];

const emptyFilters = {
  dateFrom: "",
  dateTo: "",
  period: "",
  query: "",
  responsible: "",
  status: "",
  work: "",
};

test("Todos os meses remove o recorte mensal", () => {
  assert.equal(filterReviewerNoteRows(rows, emptyFilters).length, 2);
  assert.deepEqual(
    filterReviewerNoteRows(rows, { ...emptyFilters, period: "08/2026" }).map(
      (row) => row.item.id,
    ),
    ["note-1"],
  );
});

test("combina busca, status e intervalo de datas sem filtros desconexos", () => {
  const result = filterReviewerNoteRows(rows, {
    ...emptyFilters,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    query: "fornecedor b",
    status: "Suspeita",
  });

  assert.deepEqual(result.map((row) => row.item.id), ["note-2"]);
});

test("busca também no diagnóstico e na justificativa do achado", () => {
  const rowsWithFinding = [
    {
      displayDate: "09/08/2026",
      item: item({
        findings: [
          {
            description: "O valor do pagamento diverge do recibo.",
            justification: "Diferença registrada no próprio anexo.",
            title: "Valor divergente",
          },
        ],
      }),
      status: "Suspeita",
    },
  ];

  assert.equal(
    filterReviewerNoteRows(rowsWithFinding, {
      ...emptyFilters,
      query: "diferença registrada",
    }).length,
    1,
  );
});

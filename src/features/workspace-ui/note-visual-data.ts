import "server-only";

import type { NoteListItem } from "@/features/internal-notes/note-list-query";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

export function toNoteVisualItems(items: NoteListItem[]) {
  return items.map((item) => ({
    classification:
      item.classification === "OK"
        ? "OK"
        : item.classification === "SUSPICIOUS"
          ? "Suspeita"
          : "Em análise",
    date: dateFormatter.format(item.issuedAt ?? item.createdAt),
    id: item.id,
    number: item.documentNumber ?? "Sem número",
    supplier: item.supplierName ?? "Fornecedor não identificado",
    value: item.totalAmount
      ? moneyFormatter.format(Number(item.totalAmount))
      : "—",
    work: item.workName,
  }));
}

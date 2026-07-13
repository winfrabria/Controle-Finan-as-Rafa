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
          : item.classification === "NO_PARAMETER"
            ? "Sem parâmetro"
          : "Em análise",
    date: dateFormatter.format(item.issuedAt ?? item.createdAt),
    finding: item.primaryFinding ?? undefined,
    id: item.id,
    number: item.documentNumber ?? "Sem número",
    supplier: item.supplierName ?? "Fornecedor não identificado",
    value: item.totalAmount
      ? moneyFormatter.format(Number(item.totalAmount))
      : "—",
    version: item.version,
    work: item.workName,
  }));
}

import "server-only";

import type { NoteListItem } from "@/features/internal-notes/note-list-query";
import type { NoteVisualItem } from "./note-types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

export function toNoteVisualItems(items: NoteListItem[]): NoteVisualItem[] {
  return items.map((item) => ({
    classification:
      item.status === "READ_FAILED"
        ? "Falha de leitura"
        : item.status === "FAILED"
          ? "Falha de processamento"
          : item.classification === "OK"
        ? "OK"
        : item.classification === "SUSPICIOUS"
          ? "Suspeita"
          : item.classification === "NO_PARAMETER"
            ? "Sem parâmetro"
            : item.classification === "INCOMPATIBLE"
              ? "Falha de leitura"
          : "Em análise",
    date: dateFormatter.format(item.issuedAt ?? item.createdAt),
    finding: item.primaryFinding ?? undefined,
    findings: item.findings,
    id: item.id,
    isRead: item.isRead,
    number: item.documentNumber ?? "Sem número",
    supplier: item.supplierName ?? "Fornecedor não identificado",
    value: item.totalAmount
      ? moneyFormatter.format(Number(item.totalAmount))
      : "—",
    version: item.version,
    work: item.workName,
  }));
}

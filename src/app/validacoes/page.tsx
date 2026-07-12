import type { Metadata } from "next";

import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import { ValidationView } from "@/features/workspace-ui/portal-views";

export const metadata: Metadata = {
  title: "Validações | WinfraBR",
  description: "Revise notas que exigem uma decisão humana.",
};

type ValidationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ValidationsPage({
  searchParams,
}: ValidationsPageProps) {
  const params = await searchParams;
  await requireInternalUser("/validacoes");
  const filters = parseNoteListFilters(params);
  const result = await listNotes(filters, { validationOnly: true });

  const items = result.items.map((item) => ({
    id: item.id,
    number: item.documentNumber ?? "Sem número",
    supplier: item.supplierName ?? "Fornecedor não identificado",
    date: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
    }).format(item.issuedAt ?? item.createdAt),
    value: item.totalAmount
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(Number(item.totalAmount))
      : "—",
    classification:
      item.classification === "OK"
        ? "OK"
        : item.classification === "SUSPICIOUS"
          ? "Suspeita"
          : "Em análise",
  }));

  return <ValidationView role="reviewer" items={items} />;
}

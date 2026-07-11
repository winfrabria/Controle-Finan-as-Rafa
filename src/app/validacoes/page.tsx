import type { Metadata } from "next";

import { InternalShell } from "@/features/internal-notes/internal-shell";
import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { NoteListView } from "@/features/internal-notes/note-list-view";
import { requireInternalUser } from "@/features/internal-notes/require-internal-user";

export const metadata: Metadata = {
  title: "Validações | WinfraBR",
  description: "Revise notas que exigem uma decisão humana.",
};

type ValidationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ValidationsPage({ searchParams }: ValidationsPageProps) {
  const params = await searchParams;
  const user = await requireInternalUser("/validacoes");
  const filters = parseNoteListFilters(params);
  const result = await listNotes(filters, { validationOnly: true });

  return (
    <InternalShell
      activePath="/validacoes"
      description="Priorize as notas que precisam da sua decisão."
      email={user.email ?? "usuario@winfrabr.com.br"}
      eyebrow="Fila de revisão"
      title="Validações"
    >
      <NoteListView
        {...result}
        filters={filters}
        pathname="/validacoes"
        searchParams={params}
        validationOnly
      />
    </InternalShell>
  );
}

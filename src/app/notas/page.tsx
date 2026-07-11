import type { Metadata } from "next";

import { InternalShell } from "@/features/internal-notes/internal-shell";
import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { NoteListView } from "@/features/internal-notes/note-list-view";
import { requireInternalUser } from "@/features/internal-notes/require-internal-user";

export const metadata: Metadata = {
  title: "Notas | WinfraBR",
  description: "Acompanhe as notas enviadas para auditoria.",
};

type NotesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const params = await searchParams;
  const user = await requireInternalUser("/notas");
  const filters = parseNoteListFilters(params);
  const result = await listNotes(filters);

  return (
    <InternalShell
      activePath="/notas"
      description="Consulte, filtre e acompanhe todas as notas recebidas."
      email={user.email ?? "usuario@winfrabr.com.br"}
      eyebrow="Auditoria de gastos"
      title="Notas"
    >
      <NoteListView
        {...result}
        filters={filters}
        pathname="/notas"
        searchParams={params}
      />
    </InternalShell>
  );
}

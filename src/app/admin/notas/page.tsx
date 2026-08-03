import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { toNoteVisualItems } from "@/features/workspace-ui/note-visual-data";
import { NotesView } from "@/features/workspace-ui/portal-views";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminNotesPage({ searchParams }: PageProps) {
  const filters = parseNoteListFilters(await searchParams);
  const result = await listNotes(filters, { all: true });
  return (
    <NotesView
      role="admin"
      total={result.total}
      items={toNoteVisualItems(result.items)}
    />
  );
}

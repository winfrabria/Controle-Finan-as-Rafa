import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { toNoteVisualItems } from "@/features/workspace-ui/note-visual-data";
import { NotesView } from "@/features/workspace-ui/portal-views";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewerNotesPage({ searchParams }: PageProps) {
  const filters = parseNoteListFilters(await searchParams);
  const result = await listNotes(filters);
  return <NotesView role="reviewer" items={toNoteVisualItems(result.items)} />;
}

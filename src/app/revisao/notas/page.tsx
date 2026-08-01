import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { toNoteVisualItems } from "@/features/workspace-ui/note-visual-data";
import { NotesView } from "@/features/workspace-ui/portal-views";
import { REVIEW_ROLES } from "@/server/auth/access-policy";
import { requirePageRoles } from "@/server/auth/authorization";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewerNotesPage({ searchParams }: PageProps) {
  const profile = await requirePageRoles("/revisao/notas", REVIEW_ROLES);
  const params = await searchParams;
  const filters = parseNoteListFilters(params);
  const result = await listNotes(filters, { profileId: profile.id });
  return (
    <NotesView
      initialQuery={filters.documentNumber}
      role="reviewer"
      items={toNoteVisualItems(result.items)}
    />
  );
}

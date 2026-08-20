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
  const rawSelected = Array.isArray(params.anexo) ? params.anexo[0] : params.anexo;
  const initialSelectedId =
    rawSelected && /^[0-9a-f-]{36}$/i.test(rawSelected) ? rawSelected : undefined;
  const result = await listNotes(filters, {
    all: true,
    profileId: profile.id,
    readMode: "unread",
    sanitizeForReviewer: true,
  });
  return (
    <NotesView
      embedded
      initialQuery={filters.documentNumber}
      initialSelectedId={initialSelectedId}
      initialPage={result.page}
      initialPageCount={result.pageCount}
      total={result.total}
      role="reviewer"
      items={toNoteVisualItems(result.items)}
    />
  );
}

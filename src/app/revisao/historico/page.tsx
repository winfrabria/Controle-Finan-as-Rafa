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

export default async function ReviewerHistoryPage({ searchParams }: PageProps) {
  const profile = await requirePageRoles("/revisao/historico", REVIEW_ROLES);
  const params = await searchParams;
  const filters = parseNoteListFilters(params);
  const rawSelected = Array.isArray(params.anexo) ? params.anexo[0] : params.anexo;
  const initialSelectedId =
    rawSelected && /^[0-9a-f-]{36}$/i.test(rawSelected) ? rawSelected : undefined;
  const result = await listNotes(filters, {
    all: true,
    profileId: profile.id,
    readMode: "read",
    sanitizeForReviewer: true,
  });

  return (
    <NotesView
      historyMode
      initialQuery={filters.documentNumber}
      initialSelectedId={initialSelectedId}
      initialPage={result.page}
      initialPageCount={result.pageCount}
      items={toNoteVisualItems(result.items)}
      role="reviewer"
      total={result.total}
    />
  );
}

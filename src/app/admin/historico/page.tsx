import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { toNoteVisualItems } from "@/features/workspace-ui/note-visual-data";
import { NotesView } from "@/features/workspace-ui/portal-views";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminHistoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseNoteListFilters(params);
  const rawSelected = Array.isArray(params.anexo) ? params.anexo[0] : params.anexo;
  const initialSelectedId =
    rawSelected && /^[0-9a-f-]{36}$/i.test(rawSelected) ? rawSelected : undefined;
  const result = await listNotes(filters, {
    all: true,
    readMode: "read",
  });

  return (
    <NotesView
      historyMode
      initialQuery={filters.documentNumber}
      initialSelectedId={initialSelectedId}
      initialPage={result.page}
      initialPageCount={result.pageCount}
      items={toNoteVisualItems(result.items)}
      role="admin"
      total={result.total}
    />
  );
}

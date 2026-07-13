import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { toNoteVisualItems } from "@/features/workspace-ui/note-visual-data";
import { ValidationWorkspace } from "@/features/workspace-ui/validation-workspace";
import { NoteClassification } from "@/generated/prisma/enums";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewerValidationsPage({
  searchParams,
}: PageProps) {
  const filters = parseNoteListFilters(await searchParams);
  const result = await listNotes(
    {
      ...filters,
      classificacao: NoteClassification.SUSPICIOUS,
    },
    { validationOnly: true },
  );
  return (
    <ValidationWorkspace
      items={toNoteVisualItems(result.items)}
      role="reviewer"
      meta={{
        filters: {
          dataAte: filters.dataAte,
          dataDe: filters.dataDe,
          obra: filters.obra,
        },
        page: result.page,
        pageCount: result.pageCount,
        total: result.total,
        works: result.works,
      }}
    />
  );
}

import {
  listNotes,
  parseNoteListFilters,
} from "@/features/internal-notes/note-list-query";
import { toNoteVisualItems } from "@/features/workspace-ui/note-visual-data";
import { ValidationView } from "@/features/workspace-ui/portal-views";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewerValidationsPage({
  searchParams,
}: PageProps) {
  const filters = parseNoteListFilters(await searchParams);
  const result = await listNotes(filters, { validationOnly: true });
  return (
    <ValidationView role="reviewer" items={toNoteVisualItems(result.items)} />
  );
}

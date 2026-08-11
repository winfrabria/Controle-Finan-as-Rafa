import type { NoteVisualItem } from "./note-types";

export type ReviewerNoteFilterRow = {
  displayDate: string;
  item: NoteVisualItem;
  status: string;
};

export type ReviewerNoteFilters = {
  dateFrom: string;
  dateTo: string;
  period: string;
  query: string;
  responsible: string;
  status: string;
  work: string;
};

function dateInputKey(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function periodKey(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return "";
  return `${match[2].padStart(2, "0")}/${match[3]}`;
}

export function filterReviewerNoteRows(
  rows: ReviewerNoteFilterRow[],
  filters: ReviewerNoteFilters,
) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("pt-BR");
  const hasCustomRange = Boolean(filters.dateFrom || filters.dateTo);

  return rows.filter(({ displayDate, item, status }) => {
    const searchable = [item.number, item.supplier, item.work, item.responsible]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    const dateKey = dateInputKey(displayDate);

    return (
      (!normalizedQuery || searchable.includes(normalizedQuery)) &&
      (hasCustomRange || !filters.period || periodKey(displayDate) === filters.period) &&
      (!filters.dateFrom || (dateKey !== "" && dateKey >= filters.dateFrom)) &&
      (!filters.dateTo || (dateKey !== "" && dateKey <= filters.dateTo)) &&
      (!filters.work || item.work === filters.work) &&
      (!filters.responsible || item.responsible === filters.responsible) &&
      (!filters.status || status === filters.status)
    );
  });
}

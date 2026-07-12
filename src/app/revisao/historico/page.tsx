import { ValidationHistoryView } from "@/features/validation-history/validation-history-view";
import {
  listValidationHistory,
  parseValidationHistoryFilters,
} from "@/features/validation-history/validation-history-query";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewerValidationHistoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseValidationHistoryFilters(params);
  const result = await listValidationHistory(filters);

  return <ValidationHistoryView items={result.items} meta={{ ...result, filters }} role="reviewer" searchParams={params} />;
}

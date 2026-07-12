import { ValidationHistoryView } from "@/features/validation-history/validation-history-view";
import {
  listValidationHistory,
  parseValidationHistoryFilters,
} from "@/features/validation-history/validation-history-query";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminValidationHistoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseValidationHistoryFilters(params);
  const result = await listValidationHistory(filters);

  return <ValidationHistoryView items={result.items} meta={{ ...result, filters }} role="admin" searchParams={params} />;
}

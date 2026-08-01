import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewerValidationHistoryPage({ searchParams }: PageProps) {
  void searchParams;
  redirect("/revisao/notas");
}

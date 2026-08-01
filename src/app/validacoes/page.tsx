import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Validações | WinfraBR",
  description: "Revise notas que exigem uma decisão humana.",
};

type ValidationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ValidationsPage({
  searchParams,
}: ValidationsPageProps) {
  void searchParams;
  redirect("/revisao/notas");
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import { getRoleDestination } from "@/server/auth/access-policy";

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
  const params = await searchParams;
  const profile = await requireInternalUser("/validacoes");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const selected = Array.isArray(value) ? value[0] : value;
    if (selected) query.set(key, selected);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(getRoleDestination(profile.role, `/validacoes${suffix}`));
}

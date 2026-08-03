import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import { getRoleDestination } from "@/server/auth/access-policy";

export const metadata: Metadata = {
  title: "Notas | WinfraBR",
  description: "Acompanhe as notas enviadas para auditoria.",
};

type NotesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NotesPage({ searchParams }: NotesPageProps) {
  const params = await searchParams;
  const profile = await requireInternalUser("/notas");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const selected = Array.isArray(value) ? value[0] : value;
    if (selected) query.set(key, selected);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(getRoleDestination(profile.role, `/notas${suffix}`));
}

import { notFound } from "next/navigation";

import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import { NoteAnalysisView } from "@/features/note-detail/note-analysis-view";
import { loadNoteDetail } from "@/features/note-detail/data";

type PageProps = { params: Promise<{ id: string }> };

export default async function NoteAiAnalysisPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await requireInternalUser(`/notas/${id}/analise-ia`);
  const data = await loadNoteDetail({ id, role: profile.role });

  if (!data) notFound();

  return <NoteAnalysisView data={data} userEmail={profile.email} />;
}

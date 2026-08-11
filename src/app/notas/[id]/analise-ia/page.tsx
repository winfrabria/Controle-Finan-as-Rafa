import { notFound } from "next/navigation";

import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import { NoteAnalysisView } from "@/features/note-detail/note-analysis-view";
import { loadNoteDetail } from "@/features/note-detail/data";
import { createInvoiceSignedUrl } from "@/server/storage";

type PageProps = { params: Promise<{ id: string }> };

export default async function NoteAiAnalysisPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await requireInternalUser(`/notas/${id}/analise-ia`);
  const data = await loadNoteDetail({ id, role: profile.role });

  if (!data) notFound();

  let documentUrl: string | null = null;
  if (!data.isDemo) {
    try {
      documentUrl = (
        await createInvoiceSignedUrl({ path: data.document.storagePath })
      ).signedUrl;
    } catch (error) {
      console.error("note.analysis.signed_url_failed", {
        error,
        noteId: data.id,
      });
    }
  }

  return (
    <NoteAnalysisView
      data={data}
      documentUrl={documentUrl}
      userEmail={profile.email}
    />
  );
}

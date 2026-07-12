import { notFound } from "next/navigation";

import { requireInternalUser } from "@/features/internal-notes/require-internal-user";
import { loadNoteDetail } from "@/features/note-detail/data";
import { NoteDetailView } from "@/features/note-detail/note-detail-view";
import { createInvoiceSignedUrl } from "@/server/storage";

type PageProps = { params: Promise<{ id: string }> };

export default async function NoteDetailPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await requireInternalUser(`/notas/${id}`);
  const data = await loadNoteDetail({ id, role: profile.role });

  if (!data) notFound();

  let documentUrl: string | null = null;
  if (!data.isDemo) {
    try {
      documentUrl = (
        await createInvoiceSignedUrl({ path: data.document.storagePath })
      ).signedUrl;
    } catch (error) {
      console.error("note.detail.signed_url_failed", {
        error,
        noteId: data.id,
      });
    }
  }

  return (
    <NoteDetailView
      data={data}
      documentUrl={documentUrl}
      userEmail={profile.email}
    />
  );
}

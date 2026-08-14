export type NoteDocumentPreviewKind =
  | "demo"
  | "image"
  | "pdf"
  | "unavailable";

export function resolveNoteDocumentPreviewKind({
  documentUrl,
  isDemo,
  isImage,
}: {
  documentUrl: string | null;
  isDemo: boolean;
  isImage: boolean;
}): NoteDocumentPreviewKind {
  if (documentUrl) return isImage ? "image" : "pdf";
  return isDemo ? "demo" : "unavailable";
}

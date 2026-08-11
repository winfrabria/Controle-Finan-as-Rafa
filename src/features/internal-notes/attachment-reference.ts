export function attachmentReference(documentNumber: string | null, id: string) {
  const number = documentNumber?.trim();
  if (number) return number;

  // This is only a reviewer-facing fallback. The UUID remains the canonical
  // identifier, while the screen gets a short and stable reference.
  const compactId = id.replaceAll("-", "").slice(0, 6).toUpperCase();
  return `ANX-${compactId}`;
}

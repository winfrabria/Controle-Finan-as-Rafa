export function attachmentReference(documentNumber: string | null, id: string) {
  const number = documentNumber?.trim();
  if (number) return number;

  const compactId = id.replaceAll("-", "").slice(0, 12).toUpperCase();
  return `ANX-${compactId}`;
}

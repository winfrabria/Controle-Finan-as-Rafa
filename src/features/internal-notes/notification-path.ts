type NotificationPathInput = {
  basePath: "/admin" | "/revisao";
  documentNumber?: string | null;
  isRead: boolean;
  noteId?: string | null;
};

export function notificationPath({
  basePath,
  documentNumber,
  isRead,
  noteId,
}: NotificationPathInput) {
  const section = isRead ? "historico" : "notas";
  const query = noteId
    ? `?anexo=${encodeURIComponent(noteId)}`
    : documentNumber
      ? `?busca=${encodeURIComponent(documentNumber)}`
      : "";

  return `${basePath}/${section}${query}`;
}

export async function requestNoteRead(noteId: string, noteVersion: number, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/notas/${noteId}/read`, {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST", body: JSON.stringify({ version: noteVersion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { erro?: { mensagem?: string } } | null;
    throw new Error(payload?.erro?.mensagem ?? "Não foi possível marcar a nota como lida. Tente novamente.");
  }
}

export type SubmissionHistoryEntry = {
  noteId: string;
  protocolo: string;
  stage: "READING" | "CHECKING" | "NEEDS_CONTEXT" | "COMPLETED" | "READ_FAILED" | "FAILED";
};
type SessionStore = Pick<Storage, "getItem" | "setItem">;

/** Terminal access is one-shot. A cached completion is not a new server result. */
export function canShowStoredCompletion(entry: SubmissionHistoryEntry) {
  return entry.stage === "COMPLETED";
}
const KEY = "winfrabr.public-submissions.v1";
const stages = new Set(["READING", "CHECKING", "NEEDS_CONTEXT", "COMPLETED", "READ_FAILED", "FAILED"]);

/** Session-local references only. No PDF, token, signed URL or financial data. */
export function readSubmissionHistory(store: SessionStore): SubmissionHistoryEntry[] {
  try {
    const raw = store.getItem(KEY);
    if (!raw || raw.length > 30000) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    const seen = new Set<string>();
    return entries.filter((entry): entry is SubmissionHistoryEntry => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Partial<SubmissionHistoryEntry>;
      if (typeof item.noteId !== "string" || !/^[a-z0-9-]{1,100}$/i.test(item.noteId) ||
        typeof item.protocolo !== "string" || !item.protocolo.trim() || item.protocolo.length > 120 ||
        !item.stage || !stages.has(item.stage) || seen.has(item.noteId)) return false;
      seen.add(item.noteId);return true;
    }).slice(0, 20).map(({ noteId, protocolo, stage }) => ({ noteId, protocolo, stage }));
  } catch { return []; }
}

export function rememberSubmission(store: SessionStore, entry: SubmissionHistoryEntry) {
  const result = [entry, ...readSubmissionHistory(store).filter(item => item.noteId !== entry.noteId)].slice(0, 20);
  try { store.setItem(KEY, JSON.stringify(result)); } catch { /* Storage restrictions never fail a successful upload. */ }
  return result;
}

export function submissionStageLabel(stage: SubmissionHistoryEntry["stage"]) {
  return { READING: "Recebida · leitura em segundo plano", CHECKING: "Lida · análise em segundo plano",
    NEEDS_CONTEXT: "Informação solicitada", COMPLETED: "Concluída", READ_FAILED: "Leitura não concluída",
    FAILED: "Processamento não concluído" }[stage];
}

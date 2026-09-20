import type { NoteVisualItem } from "./note-types";

/** Describe useful context without repeating the badge or implying approval. */
export function reviewerNotePrimaryReason(item: NoteVisualItem, status: string): string {
  if (status === "Falha de processamento") return "Ainda não há diagnóstico válido desta tentativa";
  if (status === "Falha de leitura") return "Não foi possível concluir a leitura do arquivo";
  if (status === "Em análise" || status === "Aguardando processamento") return "O diagnóstico estará disponível após o processamento";
  if (status === "Não processado") return "A análise deste arquivo ainda não foi iniciada";

  const finding = item.findings?.find((entry) => entry.severity?.toUpperCase() !== "INFO")?.title
    ?? item.finding;
  if (finding) return finding;
  if (status === "Precisa de informação") return "Há perguntas pendentes para concluir a análise";
  if (status === "Análise incompleta" || status === "Informação insuficiente" || status === "Revisão manual") return "Consulte o motivo da revisão manual";
  if (status === "OK") return "Nenhuma inconsistência registrada nesta análise";
  if (status === "Suspeita") return "Consulte as evidências no diagnóstico detalhado";
  return "Consulte o andamento e o diagnóstico da análise";
}

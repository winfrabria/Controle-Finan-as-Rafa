import type { NoteVisualItem } from "./note-types";

export function reviewerStatusLabel(
  item: Pick<
    NoteVisualItem,
    "activeContextQuestionCount" | "classification" | "findingCount"
  >,
) {
  const classification = item.classification?.trim();
  if (
    classification === "NEEDS_CONTEXT" ||
    classification === "NO_PARAMETER" ||
    classification === "Sem parâmetro" ||
    classification === "Análise incompleta" ||
    classification === "Informação insuficiente" ||
    classification === "Revisão manual"
  ) {
    if (item.activeContextQuestionCount && item.activeContextQuestionCount > 0) {
      return "Precisa de informação";
    }
    return item.findingCount && item.findingCount > 0
      ? "Suspeita"
      : "Revisão manual";
  }
  return classification || "Em análise";
}

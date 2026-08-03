import {
  type PublicContextQuestion,
  type PublicNoteState,
  type PublicNoteStatus,
} from "./api-contract";

export type PublicProcessingPhase = "READING" | "CHECKING";

export function resolvePublicUploadResult(
  note: PublicNoteStatus,
): PublicNoteState | null {
  return [
    "PROCESSING",
    "NEEDS_CONTEXT",
    "COMPLETED",
    "READ_FAILED",
    "FAILED",
  ].includes(note.estadoPublico)
    ? note.estadoPublico
    : null;
}

export function resolvePublicProcessingPhase(
  etapa: string | null | undefined,
): PublicProcessingPhase {
  const normalized = etapa?.trim().toUpperCase() ?? "";
  if (
    normalized.includes("ANAL") ||
    normalized.includes("AUDIT") ||
    normalized.includes("CHECK") ||
    normalized.includes("RULE") ||
    normalized.includes("CONFER")
  ) {
    return "CHECKING";
  }
  return "READING";
}

export function normalizePublicQuestions(
  questions: PublicContextQuestion[] | null | undefined,
) {
  return (questions ?? [])
    .filter(
      (question) =>
        typeof question.id === "string" &&
        question.id.trim().length > 0 &&
        typeof question.pergunta === "string" &&
        question.pergunta.trim().length > 0 &&
        ["TEXT", "NUMBER", "CONFIRMATION", "SELECT"].includes(question.tipo),
    )
    .slice(0, 3)
    .map((question) => ({
      ...question,
      id: question.id.trim(),
      pergunta: question.pergunta.trim(),
      opcoes:
        question.tipo === "SELECT"
          ? (question.opcoes ?? []).filter(
              (option) => typeof option === "string" && option.trim().length > 0,
            )
          : undefined,
    }));
}

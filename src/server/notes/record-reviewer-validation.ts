import "server-only";

export class ReviewerValidationDisabledError extends Error {
  readonly code = "DECISAO_LEGADA_DESATIVADA";

  constructor() {
    super("Aprovação e rejeição estão desativadas no MVP.");
    this.name = "ReviewerValidationDisabledError";
  }
}

export type RecordReviewerValidationInput = {
  comment: string;
  decision: "OK" | "SUSPEITA";
  noteId: string;
  noteVersion: number;
  reason: string;
  reviewerId: string;
};

export async function recordReviewerValidation(
  input: RecordReviewerValidationInput,
) {
  void input;
  throw new ReviewerValidationDisabledError();
}

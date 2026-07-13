export type PublicUploadResultKind =
  | "OK"
  | "NO_PARAMETER"
  | "SUSPICIOUS"
  | "READ_FAILED"
  | "FAILED";

export type PublicNoteStatus = {
  classificacao?: string;
  erro?: { codigo: string; mensagem: string };
  etapa: string;
  id: string;
  status: string;
};

export function resolvePublicUploadResult(
  note: PublicNoteStatus,
): PublicUploadResultKind | null {
  if (note.status === "READ_FAILED") return "READ_FAILED";
  if (note.status === "FAILED") return "FAILED";
  if (
    note.status === "PENDING_VALIDATION" ||
    note.status === "REJECTED" ||
    note.classificacao === "SUSPICIOUS"
  ) {
    return "SUSPICIOUS";
  }
  if (note.status === "OK" || note.status === "APPROVED") {
    return note.classificacao === "NO_PARAMETER" ? "NO_PARAMETER" : "OK";
  }
  return null;
}

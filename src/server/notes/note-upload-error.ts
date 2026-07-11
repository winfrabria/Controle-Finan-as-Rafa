import "server-only";

export type NoteUploadErrorCode =
  | "ARQUIVO_INVALIDO"
  | "ARQUIVO_MUITO_GRANDE"
  | "ARQUIVO_NAO_INFORMADO"
  | "FORMATO_NAO_SUPORTADO"
  | "OBRA_INDISPONIVEL"
  | "OBRA_INVALIDA"
  | "UPLOAD_INDISPONIVEL";

export class NoteUploadError extends Error {
  constructor(
    public readonly code: NoteUploadErrorCode,
    public readonly httpStatus: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NoteUploadError";
  }
}

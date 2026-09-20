import "server-only";

export type NoteUploadErrorCode =
  | "ARQUIVO_INVALIDO"
  | "ARQUIVO_MUITO_GRANDE"
  | "ARQUIVO_NAO_INFORMADO"
  | "FORMATO_NAO_SUPORTADO"
  | "LIMITE_DE_ENVIOS_ATINGIDO"
  | "OBRA_INDISPONIVEL"
  | "OBRA_INVALIDA"
  | "UPLOAD_INDISPONIVEL";

type NoteUploadErrorOptions = ErrorOptions & {
  retryAfterSeconds?: number;
};

export class NoteUploadError extends Error {
  public readonly retryAfterSeconds?: number;

  constructor(
    public readonly code: NoteUploadErrorCode,
    public readonly httpStatus: number,
    message: string,
    options?: NoteUploadErrorOptions,
  ) {
    super(message, options);
    this.name = "NoteUploadError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

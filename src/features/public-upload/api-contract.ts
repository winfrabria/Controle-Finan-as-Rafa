export const PUBLIC_UPLOAD_ENDPOINTS = {
  projects: "/api/obras",
  invoices: "/api/notas",
} as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type ProjectOption = {
  id: string;
  nome: string;
  local?: string | null;
};

export type ProjectsResponse = {
  obras: ProjectOption[];
};

export type CreateInvoiceResponse = {
  nota: {
    id: string;
    protocolo?: string;
    status?: string;
  };
};

export type PublicQuestionType =
  | "TEXT"
  | "NUMBER"
  | "CONFIRMATION"
  | "SELECT";

export type PublicContextQuestion = {
  id: string;
  pergunta: string;
  tipo: PublicQuestionType;
  obrigatoria: boolean;
  opcoes?: string[];
};

export type PublicNoteState =
  | "PROCESSING"
  | "NEEDS_CONTEXT"
  | "COMPLETED"
  | "READ_FAILED"
  | "FAILED";

export type PublicNoteStatus = {
  id: string;
  estadoPublico: PublicNoteState;
  etapa: string;
  protocolo?: string;
  perguntas?: PublicContextQuestion[];
  erro?: { codigo: string; mensagem: string };
};

export type PublicNoteStatusResponse = {
  nota: PublicNoteStatus;
};

export type PublicPreviewResponse = {
  preview: {
    expiresInSeconds: number;
    fileName: string;
    mimeType: string;
    url: string;
  };
};

export type PublicContextAnswer = {
  perguntaId: string;
  valor: string | number | boolean;
};

export type SubmitPublicContextBody = {
  respostas: PublicContextAnswer[];
};

export type ApiErrorResponse = {
  error?: string;
  message?: string;
  erro?: {
    codigo: string;
    mensagem: string;
  };
};

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
    status: string;
  };
};

export type ApiErrorResponse = {
  error?: string;
  message?: string;
  erro?: {
    codigo: string;
    mensagem: string;
  };
};

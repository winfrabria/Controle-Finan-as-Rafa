export const NOTE_UPLOAD_FIELDS = {
  file: "arquivo",
  workId: "obraId",
} as const;

export type PublicWork = {
  id: string;
  local?: string;
  nome: string;
};

export type PublicWorksResponse = {
  obras: PublicWork[];
};

export type NoteUploadResponse = {
  nota: {
    id: string;
    status: string;
  };
};

export type NoteStatusResponse = {
  nota: {
    etapa: string;
    erro?: {
      codigo: string;
      mensagem: string;
    };
    id: string;
    status: string;
  };
};

export type NoteUploadErrorResponse = {
  erro: {
    codigo: string;
    mensagem: string;
  };
};

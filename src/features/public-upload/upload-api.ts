import {
  PUBLIC_UPLOAD_ENDPOINTS,
  type ApiErrorResponse,
  type CreateInvoiceResponse,
} from "./api-contract";

type UploadInput = {
  projectId: string;
  file: File;
  onProgress: (progress: number) => void;
};

function getErrorMessage(payload: ApiErrorResponse | null, status: number) {
  if (payload?.erro?.mensagem) return payload.erro.mensagem;
  if (payload?.message || payload?.error) {
    return payload.message ?? payload.error ?? "";
  }

  if (status === 413) return "O arquivo ultrapassa o limite permitido.";
  if (status === 415) return "O formato deste arquivo não é aceito.";
  if (status >= 500) return "O serviço está indisponível no momento.";
  return "Não foi possível enviar a nota.";
}

export function uploadInvoice({ projectId, file, onProgress }: UploadInput) {
  return new Promise<CreateInvoiceResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("obraId", projectId);
    formData.append("arquivo", file);

    request.open("POST", PUBLIC_UPLOAD_ENDPOINTS.invoices);
    request.responseType = "json";

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      const payload = request.response as
        | CreateInvoiceResponse
        | ApiErrorResponse
        | null;

      if (request.status >= 200 && request.status < 300 && payload && "nota" in payload) {
        onProgress(100);
        resolve(payload);
        return;
      }

      reject(new Error(getErrorMessage(payload as ApiErrorResponse | null, request.status)));
    });

    request.addEventListener("error", () =>
      reject(new Error("Falha de conexão. Verifique sua internet e tente novamente.")),
    );
    request.addEventListener("timeout", () =>
      reject(new Error("O envio demorou mais que o esperado. Tente novamente.")),
    );

    request.timeout = 60_000;
    request.send(formData);
  });
}

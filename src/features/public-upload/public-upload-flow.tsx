"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { WinfraBrand } from "@/components/brand/winfra-brand";
import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  type ApiErrorResponse,
  type PublicContextAnswer,
  type PublicContextQuestion,
  type PublicNoteStatus,
  type PublicNoteStatusResponse,
  type PublicPreviewResponse,
  type ProjectOption,
  type SubmitPublicContextBody,
} from "./api-contract";
import { projectMatchesSearch, requestProjects } from "./projects-api";
import { uploadInvoice } from "./upload-api";
import {
  normalizePublicQuestions,
  publicProcessingMessage,
  resolvePublicProcessingPhase,
  resolvePublicUploadResult,
  type PublicProcessingPhase,
} from "./public-upload-status";
import styles from "./public-upload.module.css";
import { canShowStoredCompletion, readSubmissionHistory, rememberSubmission, submissionStageLabel, type SubmissionHistoryEntry } from "./submission-history";

// ── Ícones SVG Compartilhados ──
function IconBuilding() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}
function IconCloudUpload() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M12 12v9" />
      <path d="m16 16-4-4-4 4" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 11 2 2 4-4" />
    </svg>
  );
}
function IconInfo() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
function IconUpload() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function IconLogOut() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IconCheckCircle() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function IconX() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
function IconFilePlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}
function IconHome() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function IconFocus() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}
function IconFileText() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}
function IconPdfBadge() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15v-4" />
      <path d="M9 11h2a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1H9" />
      <path d="M13 11v4" />
      <path d="M13 11h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2" />
      <path d="M17 11v4" />
      <path d="M17 11h2" />
      <path d="M17 13h2" />
    </svg>
  );
}
function IconArrowLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

type View =
  | "form"
  | "sending"
  | "processing"
  | "context"
  | "pending"
  | "unavailable"
  | "success"
  | "error";
type FailureKind = "READ_FAILED" | "TECHNICAL";

type PreviewResource = {
  fileName: string;
  mimeType: string;
  url: string;
};

type StoredSubmission = {
  noteId: string;
  protocolo: string;
};

class ProcessingTimeoutError extends Error {}

const PUBLIC_SUBMISSION_STORAGE_KEY = "winfrabr.public-submission.v1";

function publicSessionStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try { return window.sessionStorage; } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}

function persistSubmission(submission: StoredSubmission) {
  try { publicSessionStorage().setItem(
    PUBLIC_SUBMISSION_STORAGE_KEY,
    JSON.stringify(submission),
  ); } catch { /* A received upload remains successful when storage is unavailable. */ }
}

function readStoredSubmission(): StoredSubmission | null {
  try {
    const raw = publicSessionStorage().getItem(PUBLIC_SUBMISSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSubmission>;
    if (
      typeof parsed.noteId !== "string" ||
      !parsed.noteId ||
      typeof parsed.protocolo !== "string" ||
      !parsed.protocolo
    ) {
      clearStoredSubmission();
      return null;
    }
    return { noteId: parsed.noteId, protocolo: parsed.protocolo };
  } catch {
    clearStoredSubmission();
    return null;
  }
}

function clearStoredSubmission() {
  try { publicSessionStorage().removeItem(PUBLIC_SUBMISSION_STORAGE_KEY); } catch { /* optional session recovery */ }
}

async function parseApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
  return (
    payload?.erro?.mensagem ?? payload?.message ?? payload?.error ?? fallback
  );
}

async function waitForNoteResult(
  noteId: string,
  signal: AbortSignal,
  onUpdate: (note: PublicNoteStatus) => void,
  ignoreContext: boolean,
  timeoutMs: number | null = 90_000,
) {
  const deadline =
    timeoutMs === null ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`/api/notas/${noteId}/status`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(
        await parseApiError(response, "Não foi possível consultar a análise."),
      );
    }
    const payload = (await response.json()) as PublicNoteStatusResponse;
    const note = payload.nota;
    onUpdate(note);
    const publicState = resolvePublicUploadResult(note);

    if (
      publicState &&
      publicState !== "PROCESSING" &&
      !(ignoreContext && publicState === "NEEDS_CONTEXT")
    ) {
      return note;
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Operação cancelada", "AbortError"));
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, 1_500);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  throw new ProcessingTimeoutError("A análise continua em andamento.");
}

async function submitPublicContext(
  noteId: string,
  answers: PublicContextAnswer[],
) {
  const body: SubmitPublicContextBody = { respostas: answers };
  const response = await fetch(`/api/notas/${noteId}/context`, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      await parseApiError(response, "Não foi possível enviar as informações."),
    );
  }
}

async function requestPublicPreview(noteId: string, signal: AbortSignal) {
  const response = await fetch(`/api/notas/${noteId}/preview`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Prévia indisponível.");

  const payload = (await response.json()) as PublicPreviewResponse;
  const preview = payload.preview;
  if (
    !preview ||
    typeof preview.url !== "string" ||
    typeof preview.fileName !== "string" ||
    typeof preview.mimeType !== "string"
  ) {
    throw new Error("Prévia indisponível.");
  }

  const url = new URL(preview.url, window.location.origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Prévia indisponível.");
  }

  return {
    fileName: preview.fileName,
    mimeType: preview.mimeType,
    url: url.toString(),
  } satisfies PreviewResource;
}

function formatBytes(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
}

function formatDate() {
  const d = new Date();
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function validateFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const validExtension =
    extension && ["pdf", "jpg", "jpeg", "png"].includes(extension);
  const validType = ACCEPTED_FILE_TYPES.includes(
    file.type as (typeof ACCEPTED_FILE_TYPES)[number],
  );
  if (!validType || !validExtension) return "Envie uma nota fiscal em PDF, JPG ou PNG.";
  if (file.size > MAX_FILE_SIZE_BYTES)
    return `A nota fiscal deve ter no máximo ${formatBytes(MAX_FILE_SIZE_BYTES)}.`;
  if (file.size === 0) return "A nota fiscal selecionada está vazia.";
  return null;
}

export function PublicUploadFlow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const pollingControllerRef = useRef<AbortController | null>(null);
  const contextSubmissionStartedRef = useRef(false);
  const [view, setView] = useState<View>("form");
  const [completedFromHistory, setCompletedFromHistory] = useState(false);
  const [recentSubmissions, setRecentSubmissions] = useState<SubmissionHistoryEntry[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(
    null,
  );
  const [projectQuery, setProjectQuery] = useState("");
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [processingPhase, setProcessingPhase] =
    useState<PublicProcessingPhase>("READING");
  const [questions, setQuestions] = useState<PublicContextQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [contextError, setContextError] = useState("");
  const [isSubmittingContext, setIsSubmittingContext] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [remotePreview, setRemotePreview] =
    useState<PreviewResource | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [failureKind, setFailureKind] = useState<FailureKind>("TECHNICAL");
  const [failureMessage, setFailureMessage] = useState("");
  const [canRetryProcessing, setCanRetryProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    const closeProjectPicker = (event: PointerEvent) => {
      if (
        projectPickerRef.current &&
        !projectPickerRef.current.contains(event.target as Node)
      ) {
        setIsProjectPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeProjectPicker);
    return () => document.removeEventListener("pointerdown", closeProjectPicker);
  }, []);

  useEffect(() => {
    const active = view === "sending" || isSubmittingContext;
    if (!active) return;
    return beginPwaCriticalActivity();
  }, [isSubmittingContext, view]);

  async function loadProjects() {
    setIsLoading(true);
    setLoadError(null);
    try {
      setProjects(await requestProjects());
    } catch {
      setLoadError("Não foi possível carregar as obras agora.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void requestProjects()
      .then((result) => {
        if (active) setProjects(result);
      })
      .catch(() => {
        if (active) setLoadError("Não foi possível carregar as obras agora.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const stored = readStoredSubmission();
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setRecentSubmissions(readSubmissionHistory(publicSessionStorage()));
      if (!stored) return;
      setInvoiceId(stored.noteId);
      setProtocol(stored.protocolo);
      setProcessingPhase("READING");
      setView("processing");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!file) {
      queueMicrotask(() => {
        if (!active) return;
        setPreviewUrl(null);
        setPreviewFailed(false);
      });
      return () => {
        active = false;
      };
    }
    const url = URL.createObjectURL(file);
    queueMicrotask(() => {
      if (!active) return;
      setPreviewUrl(url);
      setPreviewFailed(false);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    if (view !== "context" || !invoiceId || file) {
      queueMicrotask(() => {
        if (active) setRemotePreview(null);
      });
      return () => {
        active = false;
        controller.abort();
      };
    }

    void requestPublicPreview(invoiceId, controller.signal)
      .then((preview) => {
        if (!active) return;
        setRemotePreview(preview);
        setPreviewFailed(false);
      })
      .catch((caught) => {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) {
          return;
        }
        setRemotePreview(null);
        setPreviewFailed(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [file, invoiceId, view]);

  useEffect(() => {
    if ((view !== "processing" && view !== "pending") || !invoiceId) return;
    const controller = new AbortController();
    pollingControllerRef.current?.abort();
    pollingControllerRef.current = controller;

    void waitForNoteResult(
      invoiceId,
      controller.signal,
      (note) => {
        const phase = resolvePublicProcessingPhase(note.etapa);
        setProcessingPhase(phase);
        rememberSubmission(publicSessionStorage(), { noteId: invoiceId, protocolo: note.protocolo || invoiceId,
          stage: note.estadoPublico === "PROCESSING" ? phase : note.estadoPublico });
      },
      contextSubmissionStartedRef.current,
      view === "pending" ? null : 90_000,
    )
      .then((note) => {
        const outcome = resolvePublicUploadResult(note);
        if (outcome === "NEEDS_CONTEXT") {
          const nextQuestions = normalizePublicQuestions(note.perguntas);
          if (nextQuestions.length === 0) {
            throw new Error(
              "A análise precisa de informações, mas nenhuma pergunta foi disponibilizada.",
            );
          }
          setQuestions(nextQuestions);
          setAnswers({});
          setContextError("");
          setView("context");
          return;
        }
        if (outcome === "READ_FAILED") {
          clearStoredSubmission();
          setCanRetryProcessing(false);
          setFailureKind("READ_FAILED");
          setFailureMessage(
            note.erro?.mensagem ??
              "Não foi possível identificar as informações da nota.",
          );
          setView("error");
          return;
        }
        if (outcome === "FAILED") {
          clearStoredSubmission();
          setCanRetryProcessing(false);
          setFailureKind("TECHNICAL");
          setFailureMessage(
            note.erro?.mensagem ?? "O processamento não pôde ser concluído.",
          );
          setView("error");
          return;
        }
        clearStoredSubmission();
        setCanRetryProcessing(false);
        setCompletedFromHistory(false);
        setView("success");
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof ProcessingTimeoutError) {
          setView("pending");
          return;
        }
        // A failed status request is not evidence that the server job failed.
        setView("unavailable");
      });

    return () => controller.abort();
  }, [invoiceId, view]);

  useEffect(
    () => () => {
      pollingControllerRef.current?.abort();
    },
    [],
  );

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const error = validateFile(nextFile);
    setFileError(error);
    setFile(error ? null : nextFile);
  }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  }

  async function submitSelectedFile() {
    if (!isOnline) {
      setFileError(
        "Você está sem conexão. A nota e a obra continuam nesta tela; envie quando voltar a ficar online.",
      );
      return;
    }
    if (!selectedProject) {
      setFileError("Selecione uma obra antes de enviar.");
      return;
    }
    if (!file) {
      setFileError("Selecione uma nota fiscal antes de enviar.");
      return;
    }
    setProgress(0);
    clearStoredSubmission();
    setInvoiceId(null);
    setProtocol(null);
    setFailureMessage("");
    setCanRetryProcessing(false);
    setView("sending");
    try {
      const result = await uploadInvoice({
        projectId: selectedProject.id,
        file,
        onProgress: setProgress,
      });
      if (!result.nota.id) {
        throw new Error("O envio foi recebido sem um identificador de acompanhamento.");
      }
      const nextProtocol = result.nota.protocolo || result.nota.id;
      persistSubmission({ noteId: result.nota.id, protocolo: nextProtocol });
      rememberSubmission(publicSessionStorage(), { noteId: result.nota.id, protocolo: nextProtocol, stage: "READING" });
      contextSubmissionStartedRef.current = false;
      setInvoiceId(result.nota.id);
      setProtocol(nextProtocol);
      setProcessingPhase("READING");
      setView("processing");
    } catch (caught) {
      setFailureKind("TECHNICAL");
      setCanRetryProcessing(false);
      setFailureMessage(
        caught instanceof Error
          ? caught.message
          : "Não foi possível enviar a nota.",
      );
      setView("error");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitSelectedFile();
  }

  function sendAnotherNote() {
    pollingControllerRef.current?.abort();
    clearStoredSubmission();
    setRecentSubmissions(readSubmissionHistory(publicSessionStorage()));
    setCompletedFromHistory(false);
    if (inputRef.current) inputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    contextSubmissionStartedRef.current = false;
    setFile(null);
    setFileError(null);
    setProgress(0);
    setInvoiceId(null);
    setProtocol(null);
    setProcessingPhase("READING");
    setQuestions([]);
    setAnswers({});
    setContextError("");
    setIsSubmittingContext(false);
    setRemotePreview(null);
    setFailureKind("TECHNICAL");
    setFailureMessage("");
    setCanRetryProcessing(false);
    setView("form");
  }

  function followSubmission(submission: SubmissionHistoryEntry) {
    pollingControllerRef.current?.abort();
    persistSubmission(submission);
    contextSubmissionStartedRef.current = false;
    setInvoiceId(submission.noteId);setProtocol(submission.protocolo);
    setProcessingPhase(submission.stage === "READING" ? "READING" : "CHECKING");
    if (canShowStoredCompletion(submission)) {
      clearStoredSubmission();
      setCompletedFromHistory(true);
      setView("success");
      return;
    }
    setCompletedFromHistory(false);
    setView("pending");
  }

  function chooseAnotherFile() {
    sendAnotherNote();
    window.setTimeout(() => inputRef.current?.click(), 0);
  }

  function retryProcessing() {
    if (!invoiceId || !isOnline) return;
    setFailureMessage("");
    setCanRetryProcessing(false);
    setView("processing");
  }

  async function handleContextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceId || isSubmittingContext || contextSubmissionStartedRef.current) {
      return;
    }
    if (!isOnline) {
      setContextError(
        "Você está sem conexão. Suas respostas permanecem nesta tela e poderão ser enviadas quando a conexão voltar.",
      );
      return;
    }

    const missingRequired = questions.some(
      (question) => question.obrigatoria && !answers[question.id]?.trim(),
    );
    if (missingRequired) {
      setContextError("Responda às perguntas obrigatórias antes de continuar.");
      return;
    }

    const invalidNumber = questions.some((question) => {
      if (question.tipo !== "NUMBER") return false;
      const rawValue = answers[question.id]?.trim() ?? "";
      if (!rawValue) return false;
      return !Number.isFinite(Number(rawValue.replace(",", ".")));
    });
    if (invalidNumber) {
      setContextError("Revise os campos numéricos antes de continuar.");
      return;
    }

    const preparedAnswers = questions.flatMap<PublicContextAnswer>((question) => {
      const rawValue = answers[question.id]?.trim() ?? "";
      if (!rawValue && !question.obrigatoria) return [];
      if (question.tipo === "NUMBER") {
        const numericValue = Number(rawValue.replace(",", "."));
        if (!Number.isFinite(numericValue)) return [];
        return [{ perguntaId: question.id, valor: numericValue }];
      }
      if (question.tipo === "CONFIRMATION") {
        return [{ perguntaId: question.id, valor: rawValue === "true" }];
      }
      return [{ perguntaId: question.id, valor: rawValue }];
    });

    if (preparedAnswers.length === 0) {
      setContextError("Informe ao menos uma resposta antes de continuar.");
      return;
    }

    setContextError("");
    setIsSubmittingContext(true);
    contextSubmissionStartedRef.current = true;
    try {
      await submitPublicContext(invoiceId, preparedAnswers);
      setQuestions([]);
      setAnswers({});
      setRemotePreview(null);
      setProcessingPhase("CHECKING");
      setView("processing");
    } catch (caught) {
      contextSubmissionStartedRef.current = false;
      setContextError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível enviar as informações.",
      );
    } finally {
      setIsSubmittingContext(false);
    }
  }

  const isFormView =
    view === "form" ||
    view === "sending" ||
    view === "processing" ||
    view === "context" ||
    view === "pending" ||
    view === "unavailable";
  const readFailure = failureKind === "READ_FAILED";
  const activePreview: PreviewResource | null = previewUrl
    ? {
        fileName: file?.name ?? "Arquivo recebido",
        mimeType: file?.type ?? "",
        url: previewUrl,
      }
    : remotePreview;
  const activePreviewIsPdf = Boolean(
    activePreview &&
      (activePreview.mimeType === "application/pdf" ||
        activePreview.fileName.toLowerCase().endsWith(".pdf")),
  );
  const filteredProjects = projects.filter((project) => projectMatchesSearch(project, projectQuery));

  useEffect(() => {
    const shouldWarn =
      view === "sending" ||
      view === "processing" ||
      view === "context" ||
      view === "pending";
    if (!shouldWarn) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [view]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/enviar-nota" aria-label="WinfraBR — início">
          <div className={styles.brand}>
            <WinfraBrand priority size={30} />
          </div>
        </Link>
        <Link className={styles.loginLink} href="/">
          <IconLogOut /> Acesso interno
        </Link>
      </header>

      {!isOnline ? (
        <div className={styles.offlineBanner} role="status">
          Você está offline. Os dados desta tela foram mantidos, mas o envio
          precisa de conexão.
        </div>
      ) : null}

      {isFormView ? (
        <div
          className={`${styles.content} ${view === "context" ? styles.contextContent : ""}`}
        >
          <section className={styles.mainColumn}>
            <div className={styles.titleBlock}>
              {view !== "context" ? (
                <span className={styles.eyebrow}>Envio de documentos</span>
              ) : null}
              <h1>
                {view === "context"
                  ? "Precisamos de uma informação"
                  : "Enviar nota"}
              </h1>
              <p>
                {view === "context"
                  ? "Responda às perguntas abaixo para continuarmos a análise da sua nota fiscal."
                  : "Escolha a obra, adicione o documento e acompanhe a confirmação nesta tela."}
              </p>
              {view === "form" ? (
                <span className={styles.titleMeta}>Leva menos de um minuto para enviar</span>
              ) : null}
            </div>

            {view === "form" && !file && recentSubmissions.length > 0 ? (
              <section className={styles.recentSubmissions} aria-label="Envios desta sessão">
                <h2>Envios desta sessão</h2>
                <p>Você pode enviar outra nota enquanto as anteriores são analisadas. Consulte o andamento ou reveja as confirmações já recebidas nesta sessão.</p>
                <ul>{recentSubmissions.map(submission => <li key={submission.noteId}>
                  <div><strong>{submission.protocolo}</strong><span>{submissionStageLabel(submission.stage)}</span></div>
                  <button className={styles.btnOutline} type="button" onClick={() => followSubmission(submission)}
                    aria-label={`${canShowStoredCompletion(submission) ? "Ver resumo do" : "Acompanhar"} protocolo ${submission.protocolo}`}>
                    {canShowStoredCompletion(submission) ? "Ver resumo" : "Acompanhar"}
                  </button>
                </li>)}</ul>
              </section>
            ) : null}

            <section
              className={`${styles.formCard} ${view === "context" ? styles.contextCard : ""}`}
              aria-live="polite"
            >
              <ol className={styles.stepper}>
                <li className={styles.active}>
                  <span>{view === "context" || view !== "form" ? "✓" : "1"}</span>
                  <span className={styles.stepLabel}>
                    Obra<small>Identificação</small>
                  </span>
                </li>
                <li className={selectedProject || view !== "form" ? styles.active : ""}>
                  <span>{view === "context" || view !== "form" ? "✓" : "2"}</span>
                  <span className={styles.stepLabel}>
                    Nota fiscal<small>Documento</small>
                  </span>
                </li>
                {view === "context" ? (
                  <>
                    <li className={styles.active}>
                      <span>3</span>
                      <span className={styles.stepLabel}>
                        Informações<small>Complemento</small>
                      </span>
                    </li>
                    <li>
                      <span>4</span>
                      <span className={styles.stepLabel}>
                        Conclusão<small>Confirmação</small>
                      </span>
                    </li>
                  </>
                ) : (
                  <li className={view !== "form" ? styles.active : ""}>
                    <span>3</span>
                    <span className={styles.stepLabel}>
                      Conclusão<small>Confirmação</small>
                    </span>
                  </li>
                )}
              </ol>

              {view === "form" ? (
                <form className={styles.publicUploadForm} onSubmit={handleSubmit}>
                  <input
                    ref={inputRef}
                    type="file"
                    className={styles.fileInput}
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    onChange={handleFileChange}
                  />
                  <input
                    accept="image/jpeg,image/png"
                    capture="environment"
                    className={styles.fileInput}
                    onChange={handleFileChange}
                    ref={cameraInputRef}
                    type="file"
                  />
                  <div className={styles.formBody}>
                    <section className={styles.formSection}>
                      <div className={styles.sectionTitle}>
                        <span>01</span>
                        <h2>Escolha a obra</h2>
                      </div>
                      <label className={styles.label} htmlFor="project-search">
                        Obra relacionada <b>*</b>
                      </label>
                      <div className={styles.projectPicker} ref={projectPickerRef}>
                        <div
                          className={`${styles.projectSearchShell} ${isProjectPickerOpen ? styles.open : ""}`}
                        >
                          <IconFocus />
                          <input
                            aria-autocomplete="list"
                            aria-controls="project-options"
                            aria-expanded={isProjectPickerOpen}
                            autoComplete="off"
                            disabled={isLoading}
                            id="project-search"
                            onChange={(event) => {
                              setProjectQuery(event.target.value);
                              if (
                                selectedProject &&
                                event.target.value !== selectedProject.nome
                              ) {
                                setSelectedProject(null);
                              }
                              setIsProjectPickerOpen(true);
                              setFileError(null);
                            }}
                            onFocus={() => setIsProjectPickerOpen(true)}
                            placeholder={
                              isLoading
                                ? "Carregando obras..."
                                : "Buscar por nome, código ou cidade"
                            }
                            role="combobox"
                            type="search"
                            value={projectQuery}
                          />
                          <span className={styles.projectChevron} aria-hidden="true" />
                        </div>
                        {isProjectPickerOpen && !isLoading ? (
                          <div
                            className={styles.projectOptions}
                            id="project-options"
                            role="listbox"
                          >
                            {filteredProjects.length > 0 ? (
                              filteredProjects.map((project) => (
                                <button
                                  aria-selected={selectedProject?.id === project.id}
                                  className={`${styles.projectOption} ${selectedProject?.id === project.id ? styles.selected : ""}`}
                                  key={project.id}
                                  onClick={() => {
                                    setSelectedProject(project);
                                    setProjectQuery(project.nome);
                                    setIsProjectPickerOpen(false);
                                    setFileError(null);
                                  }}
                                  role="option"
                                  type="button"
                                >
                                  <span>
                                    <strong>{project.nome}</strong>
                                    {project.local ? <small>{project.local}</small> : null}
                                  </span>
                                  {selectedProject?.id === project.id ? (
                                    <IconCheckCircle />
                                  ) : null}
                                </button>
                              ))
                            ) : (
                              <p className={styles.projectEmpty}>
                                Nenhuma obra encontrada.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {selectedProject ? (
                        <div className={styles.selectedProject} aria-live="polite">
                          <span className={styles.selectedProjectBadge}>
                            <IconBuilding />
                          </span>
                          <span className={styles.selectedProjectCopy}>
                            <small>Obra selecionada</small>
                            <strong>
                              {selectedProject.nome}
                              {selectedProject.local
                                ? ` · ${selectedProject.local}`
                                : ""}
                            </strong>
                          </span>
                          <button
                            aria-label="Limpar obra selecionada"
                            className={styles.clearProject}
                            onClick={() => {
                              setSelectedProject(null);
                              setProjectQuery("");
                              setIsProjectPickerOpen(true);
                            }}
                            type="button"
                          >
                            <IconX />
                          </button>
                        </div>
                      ) : null}
                      <p className={styles.projectHelper}>
                        Digite parte do nome, código ou cidade para encontrar
                        rapidamente a obra.
                      </p>
                      {loadError ? (
                        <p className={styles.fieldError} role="alert">
                          {loadError}{" "}
                          <button type="button" onClick={() => void loadProjects()}>
                            Tentar novamente
                          </button>
                        </p>
                      ) : null}
                    </section>

                    <section className={styles.formSection}>
                      <div className={styles.sectionTitle}>
                        <span>02</span>
                        <h2>Selecione a nota</h2>
                      </div>
                      {!file ? (
                        <div
                          className={`${styles.dropzone} ${isDragging ? styles.dragging : ""}`}
                          onDragEnter={(event) => {
                            event.preventDefault();
                            setIsDragging(true);
                          }}
                          onDragLeave={() => setIsDragging(false)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={handleDrop}
                          onClick={() => inputRef.current?.click()}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              inputRef.current?.click();
                            }
                          }}
                        >
                          <span className={styles.uploadCircle}>
                            <IconCloudUpload />
                          </span>
                          <strong>Arraste a nota aqui</strong>
                          <p>ou escolha um arquivo do seu dispositivo</p>
                          <div className={styles.fileSourceActions}>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                cameraInputRef.current?.click();
                              }}
                              type="button"
                            >
                              Tirar foto
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                inputRef.current?.click();
                              }}
                              type="button"
                            >
                              Escolher arquivo
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.selectedFileCard} aria-live="polite">
                          <span className={styles.fileTypeLarge}>
                            {file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}
                          </span>
                          <span className={styles.selectedFileMeta}>
                            <small>Nota selecionada</small>
                            <strong title={file.name}>{file.name}</strong>
                            <span>{formatBytes(file.size)}</span>
                            <em>
                              <IconCheckCircle /> Pronta para envio
                            </em>
                          </span>
                          <span className={styles.selectedFileActions}>
                            <button
                              onClick={() => inputRef.current?.click()}
                              type="button"
                            >
                              Trocar
                            </button>
                            <button
                              className={styles.removeFileButton}
                              onClick={() => setFile(null)}
                              type="button"
                            >
                              Remover
                            </button>
                          </span>
                        </div>
                      )}
                      {fileError ? (
                        <p className={styles.fieldError} role="alert">
                          {fileError}
                        </p>
                      ) : null}
                    </section>
                  </div>

                  <footer className={styles.formFooter}>
                    <p className={styles.formatInfo}>
                      <IconInfo /> PDF, JPG ou PNG · máximo de{" "}
                      {formatBytes(MAX_FILE_SIZE_BYTES)} · um documento por envio
                    </p>
                    <button
                      className={styles.submitBtn}
                      type="submit"
                      disabled={!selectedProject || !file || !isOnline}
                    >
                      <IconUpload /> Enviar nota
                    </button>
                  </footer>
                </form>
              ) : null}

              {view === "sending" ? (
                <Status
                  icon={<IconCloudUpload />}
                  title="Enviando nota fiscal"
                  text="Mantenha esta página aberta até a nota fiscal ser recebida."
                >
                  <ProcessingSteps current="UPLOADING" />
                  <div className={styles.progress}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <strong>{progress}% enviado</strong>
                </Status>
              ) : null}
              {view === "processing" ? (
                <Status
                  icon={<IconFileText />}
                  title={publicProcessingMessage(processingPhase).title}
                  text={publicProcessingMessage(processingPhase).text}
                >
                  {protocol ? (
                    <p className={styles.protocolInline}>
                      Protocolo: <strong>{protocol}</strong>
                    </p>
                  ) : null}
                  <ProcessingSteps current={processingPhase} />
                  <p className={styles.pulsing}>
                    {publicProcessingMessage(processingPhase).activity}
                  </p>
                  <div className={styles.processingActions}>
                    <button
                      className={styles.submitBtn}
                      onClick={sendAnotherNote}
                      type="button"
                    >
                      <IconFilePlus /> Enviar outra nota
                    </button>
                    <button
                      className={styles.btnOutline}
                      onClick={() => setView("pending")}
                      type="button"
                    >
                      Acompanhar esta nota
                    </button>
                  </div>
                </Status>
              ) : null}
              {view === "pending" ? (
                <Status
                  icon={<IconInfo />}
                  title={publicProcessingMessage(processingPhase).activity}
                  text={publicProcessingMessage(processingPhase).text}
                >
                  <ProcessingSteps current={processingPhase} />
                  {protocol ? (
                    <p className={styles.protocolInline}>
                      Protocolo: <strong>{protocol}</strong>
                    </p>
                  ) : null}
                  <div className={styles.processingActions}>
                    <button
                      className={styles.submitBtn}
                      onClick={sendAnotherNote}
                      type="button"
                    >
                      <IconFilePlus /> Enviar outra nota
                    </button>
                    <button
                      className={styles.btnOutline}
                      disabled={!isOnline}
                      onClick={retryProcessing}
                      type="button"
                    >
                      Consultar andamento
                    </button>
                  </div>
                </Status>
              ) : null}
              {view === "unavailable" ? (
                <Status
                  icon={<IconInfo />}
                  title="Consulta de andamento indisponível"
                  text="Isso não indica falha no processamento. O acesso temporário pode ter expirado ou a conexão estar indisponível. Guarde o protocolo e, se precisar, consulte o responsável pela obra."
                >
                  {protocol ? (
                    <p className={styles.protocolInline}>
                      Protocolo: <strong>{protocol}</strong>
                    </p>
                  ) : null}
                  <div className={styles.processingActions}>
                    <button className={styles.submitBtn} onClick={sendAnotherNote} type="button">
                      <IconFilePlus /> Enviar outra nota
                    </button>
                    <button className={styles.btnOutline} onClick={retryProcessing} disabled={!isOnline} type="button">
                      Consultar novamente
                    </button>
                  </div>
                </Status>
              ) : null}
              {view === "context" ? (
                <div className={styles.contextFlow}>
                  <div className={styles.contextSummary}>
                    <span className={styles.contextSummaryIcon}>
                      <IconPdfBadge />
                    </span>
                    <div className={styles.contextSummaryText}>
                      <span>Nota fiscal recebida</span>
                      <strong title={activePreview?.fileName}>
                        {activePreview?.fileName ?? "Nota fiscal enviada"}
                      </strong>
                      <small>
                        {activePreview
                          ? "Nota fiscal pronta para complementar a análise"
                          : "Nota fiscal protegida nesta sessão"}
                      </small>
                    </div>
                    <span className={styles.contextSummaryStatus}>
                      <IconInfo /> Em análise
                    </span>
                  </div>

                  <div className={styles.contextLayout}>
                    <details className={styles.previewDisclosure}>
                      <summary>
                        <span>Visualizar nota fiscal</span>
                        <IconArrowLeft />
                      </summary>
                      <section
                        aria-label="Prévia da nota fiscal enviada"
                        className={styles.previewCard}
                      >
                        <div className={styles.previewHeader}>
                          <span>Nota fiscal enviada</span>
                          <strong title={activePreview?.fileName}>
                            {activePreview?.fileName ?? "Nota fiscal recebida"}
                          </strong>
                        </div>
                        <div className={styles.previewFrame}>
                          {activePreview && !previewFailed ? (
                            activePreviewIsPdf ? (
                              <iframe
                                onError={() => setPreviewFailed(true)}
                                referrerPolicy="no-referrer"
                                src={activePreview.url}
                                title={`Prévia de ${activePreview.fileName}`}
                              />
                            ) : (
                              <Image
                                alt={`Prévia de ${activePreview.fileName}`}
                                height={720}
                                onError={() => setPreviewFailed(true)}
                                referrerPolicy="no-referrer"
                                src={activePreview.url}
                                unoptimized
                                width={960}
                              />
                            )
                          ) : (
                            <div className={styles.previewFallback}>
                              <IconFileText />
                              <strong>Prévia indisponível nesta sessão</strong>
                              <span>
                                A nota fiscal foi recebida e continua protegida
                                no sistema.
                              </span>
                            </div>
                          )}
                        </div>
                      </section>
                    </details>

                    <form
                      className={styles.contextForm}
                      onSubmit={handleContextSubmit}
                    >
                      <div className={styles.contextFormHeading}>
                        <h2>Informações sobre a nota fiscal</h2>
                        <p>
                          Responda apenas o que a análise automática não
                          conseguiu confirmar.
                        </p>
                      </div>
                      <div className={styles.questionCount}>
                        {questions.length === 1
                          ? "1 informação necessária"
                          : `${questions.length} informações necessárias`}
                      </div>
                      {questions.map((question, index) => (
                        <ContextQuestionField
                          answer={answers[question.id] ?? ""}
                          index={index}
                          key={question.id}
                          onChange={(value) => {
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: value,
                            }));
                            setContextError("");
                          }}
                          question={question}
                          total={questions.length}
                        />
                      ))}
                      {contextError ? (
                        <p className={styles.contextError} role="alert">
                          {contextError}
                        </p>
                      ) : null}
                      <button
                        className={styles.submitBtn}
                        disabled={isSubmittingContext || !isOnline}
                        type="submit"
                      >
                        {isSubmittingContext
                          ? "Enviando informações..."
                          : "Enviar informações"}
                      </button>
                      <p className={styles.contextHint}>
                        Depois do envio, a análise continuará automaticamente.
                      </p>
                      <button
                        className={styles.contextBack}
                        onClick={() => setView("form")}
                        type="button"
                      >
                        <IconArrowLeft /> Voltar para a nota fiscal
                      </button>
                    </form>
                  </div>
                </div>
              ) : null}
            </section>
          </section>

          <aside
            className={`${styles.sidebar} ${view === "context" ? styles.sidebarHidden : ""}`}
          >
            <section className={styles.infoCard}>
              <h2>Como funciona</h2>
              <div className={styles.infoRow}>
                <span className={styles.infoIconWrap}>
                  <IconBuilding />
                </span>
                <div>
                  <h3>1. Selecione a obra</h3>
                  <p>
                    Escolha a obra relacionada à nota fiscal que você deseja
                    enviar.
                  </p>
                </div>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoIconWrap}>
                  <IconCloudUpload />
                </span>
                <div>
                  <h3>2. Envie sua nota fiscal</h3>
                  <p>
                    Faça o upload de uma nota fiscal por vez.
                    <br />
                    Formatos aceitos: PDF, JPG, PNG.
                  </p>
                </div>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoIconWrap}>
                  <IconShieldCheck />
                </span>
                <div>
                  <h3>3. Análise e retorno</h3>
                  <p>
                    Nossa equipe analisará sua nota e entrará em contato caso
                    seja necessário.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      ) : (
        // ── VIEW DE RESULTADOS (SUCESSO / ERRO) ──
        <div className={styles.resultContainer}>
          <div className={styles.resultBackground} />

          {view === "success" && (
            <div className={styles.resultCard}>
              <div
                className={styles.resultIconSuccess}
              >
                <IconCheckCircle />
              </div>
              <h2>Nota fiscal enviada com sucesso</h2>
              <p>
                {completedFromHistory
                  ? "Conclusão já recebida nesta sessão. Este resumo foi guardado no dispositivo e não representa uma nova consulta ao sistema."
                  : "A nota fiscal foi recebida e encaminhada com segurança para o sistema."}
              </p>
              <span className={styles.badgeSuccess}>
                <IconCheckCircle /> Envio concluído
              </span>

              <div className={styles.summaryBoxSuccess}>
                <div className={styles.summaryRow}>
                  <span
                    className={styles.summaryIcon}
                    style={{ background: "#FEE2E2", color: "#DC2626" }}
                  >
                    <IconPdfBadge />
                  </span>
                    <span className={styles.summaryLabel}>Nota fiscal</span>
                    <span className={styles.summaryValue}>
                    {file?.name || "Nota fiscal enviada"}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryIcon}>
                    <IconBuilding />
                  </span>
                  <span className={styles.summaryLabel}>Obra selecionada</span>
                  <span className={styles.summaryValue}>
                    {selectedProject?.nome || "Obra informada no envio"}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryIcon}>
                    <IconCalendar />
                  </span>
                  <span className={styles.summaryLabel}>
                    Consulta neste dispositivo
                  </span>
                  <span className={styles.summaryValue}>{formatDate()}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryIcon}>
                    <IconShieldCheck />
                  </span>
                  <span className={styles.summaryLabel}>Protocolo</span>
                  <span className={styles.summaryValue}>
                    {protocol || invoiceId || "Protocolo indisponível"}
                  </span>
                </div>
              </div>

              <div className={styles.resultButtons}>
                <button className={styles.submitBtn} onClick={sendAnotherNote} type="button">
                  <IconFilePlus /> Enviar nova nota
                </button>
                <Link href="/" className={styles.btnOutline}>
                  <IconHome /> Voltar ao início
                </Link>
              </div>
            </div>
          )}

          {view === "error" && (
            <div className={styles.errorContentWrapper}>
              <div className={`${styles.resultCard} ${styles.errorResultCard}`}>
                <div className={styles.resultIconError}>
                  <IconAlertTriangle />
                </div>
                <h2>
                  {readFailure
                    ? "Não foi possível ler este documento"
                    : "Não conseguimos concluir a análise agora"}
                </h2>
                <p>
                  {readFailure
                    ? failureMessage ||
                      "O arquivo parece estar vazio, corrompido, protegido por senha ou sem conteúdo legível. Envie uma nova cópia."
                    : "O arquivo foi recebido, mas o serviço de análise foi interrompido. Isso não significa que o documento esteja ilegível."}
                </p>

                <div className={styles.summaryBoxError}>
                  <div className={styles.summaryHeader}>Resumo do envio</div>
                  <div className={styles.summaryGrid}>
                    <div className={styles.summaryCol}>
                      <span
                        className={styles.summaryIconSquare}
                        style={{ color: "#0052FF" }}
                      >
                        <IconPdfBadge />
                      </span>
                      <div className={styles.summaryTextGroup}>
                        <span className={styles.summaryLabelSmall}>
                          Nota fiscal enviada
                        </span>
                        <span
                          className={styles.summaryValueBig}
                          title={file?.name}
                        >
                          {file?.name || "Nota fiscal recebida"}
                        </span>
                        <span className={styles.summarySub}>
                          {file ? formatBytes(file.size) : "Arquivo recebido"}
                        </span>
                      </div>
                    </div>
                    <div className={styles.summaryCol}>
                      <span
                        className={styles.summaryIconSquare}
                        style={{ color: "#0052FF" }}
                      >
                        <IconBuilding />
                      </span>
                      <div className={styles.summaryTextGroup}>
                        <span className={styles.summaryLabelSmall}>
                          Obra selecionada
                        </span>
                        <span className={styles.summaryValueBig}>
                          {selectedProject?.nome || "Obra informada no envio"}
                        </span>
                      </div>
                    </div>
                    <div className={styles.summaryCol}>
                      <div className={styles.summaryTextGroup}>
                        <span className={styles.summaryLabelSmall}>
                          Status da leitura
                        </span>
                        <span className={styles.badgeError}>
                          <IconX /> {readFailure ? "Falha de leitura" : "Falha de processamento"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.resultButtonsRow}>
                  {canRetryProcessing ? (
                    <button
                      className={styles.submitBtn}
                      disabled={!isOnline}
                      onClick={retryProcessing}
                      type="button"
                    >
                      <IconFocus /> Tentar novamente
                    </button>
                  ) : null}
                  {!canRetryProcessing && !readFailure && file && selectedProject ? (
                    <button
                      className={styles.submitBtn}
                      disabled={!isOnline}
                      onClick={() => void submitSelectedFile()}
                      type="button"
                    >
                      <IconUpload /> Reenviar este arquivo
                    </button>
                  ) : null}
                  {!invoiceId && file ? (
                    <button
                      className={styles.btnOutline}
                      onClick={() => setView("form")}
                      type="button"
                    >
                      Revisar dados do envio
                    </button>
                  ) : null}
                  <button
                    className={
                      canRetryProcessing || (!readFailure && file && selectedProject)
                        ? styles.btnOutline
                        : styles.submitBtn
                    }
                    onClick={readFailure ? chooseAnotherFile : sendAnotherNote}
                    type="button"
                  >
                    <IconUpload />
                    {readFailure ? "Escolher outro arquivo" : "Enviar outra nota"}
                  </button>
                  <Link href="/" className={styles.btnOutline}>
                    <IconArrowLeft /> Voltar ao início
                  </Link>
                </div>
              </div>

              {readFailure ? <div className={styles.tipsCard}>
                <h3>Dicas para um envio de qualidade</h3>
                <div className={styles.tipsGrid}>
                  <div className={styles.tipItem}>
                    <span className={styles.tipIcon}>
                      <IconFocus />
                    </span>
                    <h4>Imagem nítida</h4>
                    <p>
                      Fotografe ou digitalize com
                      <br />
                      boa iluminação e foco.
                    </p>
                  </div>
                  <div className={styles.tipItem}>
                    <span className={styles.tipIcon}>
                      <IconFileText />
                    </span>
                    <h4>Documento inteiro</h4>
                    <p>
                      Capture a nota completa, sem
                      <br />
                      cortes nas bordas.
                    </p>
                  </div>
                  <div className={styles.tipItem}>
                    <span className={styles.tipIcon}>
                      <IconPdfBadge />
                    </span>
                    <h4>Formatos aceitos</h4>
                    <p>
                      Prefira PDF, JPG ou PNG
                      <br />
                      de alta qualidade.
                    </p>
                  </div>
                  <div className={styles.tipItem}>
                    <span className={styles.tipIcon}>
                      <IconSun />
                    </span>
                    <h4>Sem reflexos</h4>
                    <p>
                      Evite sombras e reflexos
                      <br />
                      que dificultem a leitura.
                    </p>
                  </div>
                </div>
              </div> : null}
            </div>
          )}
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerRight}>
          © 2026 <span className={styles.footerRightBlue}>WinfraBR</span>.
          Todos os direitos reservados.
        </div>
      </footer>
    </main>
  );
}

function Status({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.status}>
      <span className={styles.statusIconLarge}>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

function ProcessingSteps({
  current,
}: {
  current: "UPLOADING" | PublicProcessingPhase;
}) {
  const steps = [
    { id: "UPLOADING", label: current === "UPLOADING" ? "Enviando documento" : "Documento recebido" },
    { id: "READING", label: "Lendo nota fiscal" },
    { id: "CHECKING", label: "Conferindo informações" },
  ] as const;
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <ol aria-label="Progresso do envio" className={styles.processingSteps}>
      {steps.map((step, index) => (
        <li
          aria-current={index === currentIndex ? "step" : undefined}
          data-state={
            index < currentIndex
              ? "completed"
              : index === currentIndex
                ? "active"
                : "pending"
          }
          key={step.id}
        >
          <span aria-hidden="true">{index + 1}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function ContextQuestionField({
  answer,
  index,
  onChange,
  question,
  total,
}: {
  answer: string;
  index: number;
  onChange: (value: string) => void;
  question: PublicContextQuestion;
  total: number;
}) {
  const inputId = `context-question-${index}`;
  const answerHint = contextAnswerHint(question);
  const questionLabel = (
    <>
      <span className={styles.questionPosition}>
        Pergunta {index + 1} de {total}
      </span>
      <span className={styles.questionText}>
        {question.pergunta}
        {question.obrigatoria ? <b aria-hidden="true"> *</b> : null}
      </span>
    </>
  );

  if (question.tipo === "CONFIRMATION") {
    return (
      <fieldset className={styles.questionField}>
        <legend>{questionLabel}</legend>
        <div className={styles.confirmationOptions}>
          <label>
            <input
              checked={answer === "true"}
              name={inputId}
              onChange={() => onChange("true")}
              required={question.obrigatoria}
              type="radio"
              value="true"
            />
            <span>Sim</span>
          </label>
          <label>
            <input
              checked={answer === "false"}
              name={inputId}
              onChange={() => onChange("false")}
              required={question.obrigatoria}
              type="radio"
              value="false"
            />
            <span>Não</span>
          </label>
        </div>
        <small className={styles.questionHelp}>{answerHint}</small>
      </fieldset>
    );
  }

  const options = question.opcoes ?? [];
  return (
    <div className={styles.questionField}>
      <label htmlFor={inputId}>{questionLabel}</label>
      {question.tipo === "SELECT" && options.length > 0 ? (
        <select
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          required={question.obrigatoria}
          value={answer}
        >
          <option value="">Selecione uma opção</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : question.tipo === "NUMBER" ? (
        <input
          id={inputId}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ex.: 25"
          required={question.obrigatoria}
          step="any"
          type="number"
          value={answer}
        />
      ) : (
        <textarea
          id={inputId}
          maxLength={500}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Escreva uma resposta curta e objetiva"
          required={question.obrigatoria}
          rows={3}
          value={answer}
        />
      )}
      <small className={styles.questionHelp}>{answerHint}</small>
    </div>
  );
}

function contextAnswerHint(question: PublicContextQuestion) {
  const prompt = question.pergunta.toLocaleLowerCase("pt-BR");
  if (question.tipo === "CONFIRMATION") {
    return "Marque Sim ou Não conforme o controle da obra.";
  }
  if (question.tipo === "SELECT") {
    return "Selecione a opção que corresponde ao que você sabe. Se não tiver certeza, use Não sei quando disponível.";
  }
  if (question.tipo === "NUMBER") {
    return /pessoa|funcion[aá]ri|refei/.test(prompt)
      ? "Informe apenas a quantidade relacionada a esta despesa."
      : "Informe o número que consta no controle ou comprovante.";
  }
  if (/placa|ve[ií]culo|equipamento/.test(prompt)) {
    return "Exemplo: placa ABC1D23 ou identificação do equipamento.";
  }
  if (/\bobra\b/.test(prompt)) {
    return "Informe o nome ou código oficial usado pela empresa.";
  }
  if (/motivo|finalidade|justific/.test(prompt)) {
    return "Descreva em uma frase a finalidade da despesa.";
  }
  return "Use a informação do controle da obra ou do próprio documento.";
}

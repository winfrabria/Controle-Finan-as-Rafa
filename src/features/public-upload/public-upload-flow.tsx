"use client";

import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { WinfraBrand } from "@/components/brand/winfra-brand";
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  PUBLIC_UPLOAD_ENDPOINTS,
  type ProjectOption,
  type ProjectsResponse,
} from "./api-contract";
import { uploadInvoice } from "./upload-api";
import {
  resolvePublicUploadResult,
  type PublicNoteStatus,
} from "./public-upload-status";
import styles from "./public-upload.module.css";

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
function IconLockKeyhole() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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

type View = "form" | "sending" | "processing" | "success" | "error";
type ResultKind = "OK" | "NO_PARAMETER" | "SUSPICIOUS" | "PENDING";
type FailureKind = "READ_FAILED" | "TECHNICAL";

type NoteStatusResponse = {
  nota: PublicNoteStatus;
};

class ProcessingTimeoutError extends Error {}

async function waitForNoteResult(noteId: string, signal: AbortSignal) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const response = await fetch(`/api/notas/${noteId}/status`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error("Não foi possível consultar a análise.");
    const payload = (await response.json()) as NoteStatusResponse;
    const note = payload.nota;

    if (resolvePublicUploadResult(note)) {
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
  if (!validType || !validExtension) return "Envie um arquivo PDF, JPG ou PNG.";
  if (file.size > MAX_FILE_SIZE_BYTES)
    return `O arquivo deve ter no máximo ${formatBytes(MAX_FILE_SIZE_BYTES)}.`;
  if (file.size === 0) return "O arquivo selecionado está vazio.";
  return null;
}

async function requestProjects() {
  const response = await fetch(PUBLIC_UPLOAD_ENDPOINTS.projects, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error();
  const payload = (await response.json()) as ProjectsResponse;
  if (!Array.isArray(payload.obras)) throw new Error();
  return payload.obras;
}

export function PublicUploadFlow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const pollingControllerRef = useRef<AbortController | null>(null);
  const [view, setView] = useState<View>("form");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(
    null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [resultKind, setResultKind] = useState<ResultKind>("OK");
  const [failureKind, setFailureKind] = useState<FailureKind>("TECHNICAL");
  const [failureMessage, setFailureMessage] = useState("");

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) {
      setFileError("Selecione uma obra antes de enviar.");
      return;
    }
    if (!file) {
      setFileError("Selecione um arquivo antes de enviar.");
      return;
    }
    setProgress(0);
    setFailureMessage("");
    setView("sending");
    try {
      const result = await uploadInvoice({
        projectId: selectedProject.id,
        file,
        onProgress: setProgress,
      });
      setInvoiceId(
        result.nota.id ||
          `PRT-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000)
            .toString()
            .padStart(5, "0")}`,
      );
      setView("processing");
      const controller = new AbortController();
      pollingControllerRef.current?.abort();
      pollingControllerRef.current = controller;

      try {
        const note = await waitForNoteResult(result.nota.id, controller.signal);
        const outcome = resolvePublicUploadResult(note);
        if (outcome === "READ_FAILED") {
          setFailureKind("READ_FAILED");
          setFailureMessage(
            note.erro?.mensagem ??
              "Não foi possível identificar as informações da nota.",
          );
          setView("error");
          return;
        }
        if (outcome === "FAILED") {
          setFailureKind("TECHNICAL");
          setFailureMessage(
            note.erro?.mensagem ?? "O processamento não pôde ser concluído.",
          );
          setView("error");
          return;
        }
        setResultKind(outcome ?? "OK");
        setView("success");
      } catch (pollError) {
        if (pollError instanceof ProcessingTimeoutError) {
          setResultKind("PENDING");
          setView("success");
          return;
        }
        if (pollError instanceof DOMException && pollError.name === "AbortError") {
          return;
        }
        throw pollError;
      }
    } catch (caught) {
      setFailureKind("TECHNICAL");
      setFailureMessage(
        caught instanceof Error
          ? caught.message
          : "Não foi possível enviar a nota.",
      );
      setView("error");
    }
  }

  function startAgain() {
    pollingControllerRef.current?.abort();
    setSelectedProject(null);
    setFile(null);
    setFileError(null);
    setProgress(0);
    setInvoiceId(null);
    setResultKind("OK");
    setFailureKind("TECHNICAL");
    setFailureMessage("");
    setView("form");
  }

  async function retryProcessing() {
    if (!invoiceId) return;
    const controller = new AbortController();
    pollingControllerRef.current?.abort();
    pollingControllerRef.current = controller;
    setView("processing");
    try {
      const note = await waitForNoteResult(invoiceId, controller.signal);
      const outcome = resolvePublicUploadResult(note);
      if (outcome === "READ_FAILED" || outcome === "FAILED") {
        setFailureKind(outcome === "READ_FAILED" ? "READ_FAILED" : "TECHNICAL");
        setFailureMessage(
          note.erro?.mensagem ??
            (outcome === "READ_FAILED"
              ? "Não foi possível identificar as informações da nota."
              : "O processamento não pôde ser concluído."),
        );
        setView("error");
        return;
      }
      setResultKind(outcome ?? "OK");
      setView("success");
    } catch (caught) {
      if (caught instanceof ProcessingTimeoutError) {
        setResultKind("PENDING");
        setView("success");
        return;
      }
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setFailureKind("TECHNICAL");
      setFailureMessage(
        caught instanceof Error
          ? caught.message
          : "Não foi possível consultar a análise.",
      );
      setView("error");
    }
  }

  const isFormView =
    view === "form" || view === "sending" || view === "processing";
  const successCopy =
    resultKind === "SUSPICIOUS"
      ? {
          badge: "Encaminhada para validação",
          description:
            "A análise encontrou pontos que precisam da decisão do responsável.",
          title: "Nota recebida e em validação",
        }
      : resultKind === "NO_PARAMETER"
        ? {
            badge: "Análise concluída sem parâmetros suficientes",
            description:
              "A nota foi registrada e poderá ser reprocessada quando novos parâmetros forem cadastrados.",
            title: "Nota recebida com sucesso",
          }
        : resultKind === "PENDING"
          ? {
              badge: "Análise em andamento",
              description:
                "O arquivo foi recebido. A análise está demorando mais que o esperado, mas continuará em segundo plano.",
              title: "Nota recebida com sucesso",
            }
          : {
              badge: "Análise concluída",
              description: "Sua nota fiscal foi recebida e analisada corretamente.",
              title: "Nota enviada com sucesso",
            };
  const readFailure = failureKind === "READ_FAILED";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/enviar-nota" aria-label="WinfraBR — início">
          <div className={styles.brand}>
            <WinfraBrand priority size={30} />
          </div>
        </Link>
        <Link className={styles.loginLink} href="/">
          <IconLogOut /> Voltar para login
        </Link>
      </header>

      {isFormView ? (
        <div className={styles.content}>
          <section className={styles.mainColumn}>
            <div className={styles.titleBlock}>
              <h1>Enviar nota fiscal</h1>
              <p>
                Envie sua nota fiscal para análise sem precisar fazer login.
                <br />
                Rápido, seguro e sem complicação.
              </p>
            </div>

            <ol className={styles.stepper}>
              <li className={styles.active}>
                <span>1</span>Selecione a obra
              </li>
              <li className={view !== "form" ? styles.active : ""}>
                <span>2</span>Envie sua nota fiscal
              </li>
              <li>
                <span>3</span>Conclusão
              </li>
            </ol>

            <section className={styles.formCard} aria-live="polite">
              {view === "form" ? (
                <form onSubmit={handleSubmit}>
                  <h2>1. Selecione a obra</h2>
                  <label className={styles.label} htmlFor="project">
                    Obra <b>*</b>
                  </label>
                  <div className={styles.selectWrap}>
                    <IconBuilding />
                    <select
                      id="project"
                      disabled={isLoading}
                      value={selectedProject?.id ?? ""}
                      onChange={(event) => {
                        setSelectedProject(
                          projects.find(
                            (item) => item.id === event.target.value,
                          ) ?? null,
                        );
                        setFileError(null);
                      }}
                    >
                      <option value="">
                        {isLoading ? "Carregando obras..." : "Selecione a obra"}
                      </option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.nome}
                          {project.local ? ` — ${project.local}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {loadError ? (
                    <p className={styles.fieldError}>
                      {loadError}{" "}
                      <button type="button" onClick={() => void loadProjects()}>
                        Tentar novamente
                      </button>
                    </p>
                  ) : null}

                  <div className={styles.divider} />

                  <h2>2. Envie sua nota fiscal</h2>
                  <p className={styles.helper}>
                    Envie apenas 1 nota por vez. Formatos aceitos: PDF, JPG,
                    PNG.
                  </p>

                  <div
                    className={`${styles.dropzone} ${isDragging ? styles.dragging : ""}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        inputRef.current?.click();
                    }}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      className={styles.fileInput}
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      onChange={handleFileChange}
                    />
                    <span className={styles.uploadCircle}>
                      <IconCloudUpload />
                    </span>
                    <p>
                      <strong>Clique para selecionar</strong> ou arraste o
                      arquivo aqui
                    </p>
                    <small>
                      Tamanho máximo: 20 MB • Apenas 1 arquivo por envio
                    </small>
                  </div>

                  {file ? (
                    <div className={styles.fileRow}>
                      <span className={styles.pdfBadge}>
                        {file.name.toLowerCase().endsWith(".pdf")
                          ? "PDF"
                          : "IMG"}
                      </span>
                      <span className={styles.fileName}>
                        <strong>{file.name}</strong>
                        <small>{formatBytes(file.size)}</small>
                      </span>
                      <span className={styles.fileCheck}>
                        <IconCheckCircle />
                      </span>
                      <button
                        type="button"
                        aria-label="Remover arquivo"
                        onClick={() => setFile(null)}
                      >
                        <IconX />
                      </button>
                    </div>
                  ) : null}
                  {fileError ? (
                    <p className={styles.fieldError} role="alert">
                      {fileError}
                    </p>
                  ) : null}

                  <button
                    className={styles.submitBtn}
                    type="submit"
                    disabled={!selectedProject || !file}
                  >
                    <IconUpload /> Enviar nota fiscal
                  </button>

                  <p className={styles.lockNote}>
                    <IconLockKeyhole />
                    <span>
                      Não é necessário login. Seus dados estão protegidos com
                      criptografia de ponta a ponta.
                    </span>
                  </p>
                </form>
              ) : null}

              {view === "sending" ? (
                <Status
                  icon={<IconCloudUpload />}
                  title="Enviando sua nota"
                  text="Mantenha esta página aberta até o arquivo ser recebido."
                >
                  <div className={styles.progress}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <strong>{progress}% enviado</strong>
                </Status>
              ) : null}
              {view === "processing" ? (
                <Status
                  icon={<IconCloudUpload />}
                  title="Arquivo recebido"
                  text="Estamos preparando a nota para análise."
                >
                  <p className={styles.ok}>✓ Upload concluído</p>
                  <p className={styles.pulsing}>● Preparando processamento</p>
                </Status>
              ) : null}
            </section>
          </section>

          <aside className={styles.sidebar}>
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
                    Faça o upload da 1 nota fiscal por vez.
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
            <section className={styles.infoCard}>
              <h2>Segurança e privacidade</h2>
              <div
                className={styles.infoRow}
                style={{
                  borderBottom: "none",
                  marginBottom: 0,
                  paddingBottom: 0,
                }}
              >
                <span className={styles.infoIconWrap}>
                  <IconShieldCheck />
                </span>
                <div>
                  <p>
                    Suas informações e documentos são tratados com total
                    segurança e confidencialidade. Utilizamos criptografia de
                    ponta a ponta e seguimos a LGPD.
                  </p>
                </div>
              </div>
            </section>
            <section className={styles.noticeAlert}>
              <span className={styles.noticeIcon}>
                <IconInfo />
              </span>
              <div>
                <strong>Este envio não requer login.</strong>
                <p>
                  Se for necessário acompanhar o status, nossa equipe entrará em
                  contato pelos dados informados na nota.
                </p>
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
                data-result={resultKind.toLowerCase()}
              >
                <IconCheckCircle />
              </div>
              <h2>{successCopy.title}</h2>
              <p>{successCopy.description}</p>
              <span className={styles.badgeSuccess} data-result={resultKind.toLowerCase()}>
                <IconCheckCircle /> {successCopy.badge}
              </span>

              <div className={styles.summaryBoxSuccess}>
                <div className={styles.summaryRow}>
                  <span
                    className={styles.summaryIcon}
                    style={{ background: "#FEE2E2", color: "#DC2626" }}
                  >
                    <IconPdfBadge />
                  </span>
                  <span className={styles.summaryLabel}>Arquivo da nota</span>
                  <span className={styles.summaryValue}>
                    {file?.name || "NF_12548_ABC_Construtora.pdf"}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryIcon}>
                    <IconBuilding />
                  </span>
                  <span className={styles.summaryLabel}>Obra selecionada</span>
                  <span className={styles.summaryValue}>
                    {selectedProject?.nome || "Projeto Piloto"}
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryIcon}>
                    <IconCalendar />
                  </span>
                  <span className={styles.summaryLabel}>
                    Data e hora do envio
                  </span>
                  <span className={styles.summaryValue}>{formatDate()}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryIcon}>
                    <IconShieldCheck />
                  </span>
                  <span className={styles.summaryLabel}>Protocolo</span>
                  <span className={styles.summaryValue}>
                    {invoiceId || "PRT-2024-00012345"}
                  </span>
                </div>
              </div>

              <div className={styles.resultButtons}>
                {resultKind === "PENDING" ? (
                  <button className={styles.submitBtn} onClick={() => void retryProcessing()}>
                    <IconFocus /> Atualizar análise
                  </button>
                ) : null}
                <button className={styles.submitBtn} onClick={startAgain}>
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
              <div className={styles.resultCard}>
                <div className={styles.resultIconError}>
                  <IconAlertTriangle />
                </div>
                <h2>
                  {readFailure
                    ? "Não foi possível ler a nota fiscal"
                    : "Não foi possível concluir o processamento"}
                </h2>
                <p>
                  {readFailure
                    ? failureMessage ||
                      "Recebemos o arquivo, mas não foi possível identificar corretamente as informações da nota. Envie uma imagem mais nítida."
                    : failureMessage ||
                      "Ocorreu uma falha técnica durante o envio ou processamento. Tente novamente em alguns instantes."}
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
                          Arquivo enviado
                        </span>
                        <span
                          className={styles.summaryValueBig}
                          title={file?.name}
                        >
                          {file?.name || "NF_12548_ABC_Construtora.pdf"}
                        </span>
                        <span className={styles.summarySub}>
                          {file ? formatBytes(file.size) : "1,2 MB"}
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
                          {selectedProject?.nome || "Projeto Piloto"}
                        </span>
                      </div>
                    </div>
                    <div className={styles.summaryCol}>
                      <div className={styles.summaryTextGroup}>
                        <span className={styles.summaryLabelSmall}>
                          Status da leitura
                        </span>
                        <span className={styles.badgeError}>
                          <IconX /> {readFailure ? "Leitura não realizada" : "Processamento interrompido"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.resultButtonsRow}>
                  <button className={styles.submitBtn} onClick={startAgain}>
                    <IconUpload /> Enviar nova nota
                  </button>
                  <Link href="/" className={styles.btnOutline}>
                    <IconArrowLeft /> Voltar ao início
                  </Link>
                </div>
              </div>

              <div className={styles.tipsCard}>
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
              </div>
            </div>
          )}
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <div className={styles.footerItem}>
            <IconShieldCheck />
            <span>Ambiente seguro e em conformidade com a LGPD</span>
          </div>
          <div className={styles.footerDivider} />
          <div className={styles.footerItem}>
            <IconLockKeyhole />
            <span>
              Seus dados estão protegidos com criptografia de ponta a ponta.
            </span>
          </div>
        </div>
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

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

import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  PUBLIC_UPLOAD_ENDPOINTS,
  type ProjectOption,
  type ProjectsResponse,
} from "./api-contract";
import { uploadInvoice } from "./upload-api";
import styles from "./public-upload.module.css";

type View = "projects" | "file" | "sending" | "processing" | "success" | "error";

function formatBytes(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(value / 1024 / 1024) + " MB";
}

function validateFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const validExtension = extension && ["pdf", "jpg", "jpeg", "png"].includes(extension);
  const validType = ACCEPTED_FILE_TYPES.includes(
    file.type as (typeof ACCEPTED_FILE_TYPES)[number],
  );

  if (!validType || !validExtension) {
    return "Envie um arquivo PDF, JPG ou PNG.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `O arquivo deve ter no máximo ${formatBytes(MAX_FILE_SIZE_BYTES)}.`;
  }
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
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

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

  function chooseProject(project: ProjectOption) {
    setSelectedProject(project);
    setView("file");
  }

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
    if (!selectedProject || !file) {
      setFileError("Selecione um arquivo antes de enviar.");
      return;
    }

    setProgress(0);
    setSendError(null);
    setView("sending");

    try {
      const result = await uploadInvoice({
        projectId: selectedProject.id,
        file,
        onProgress: setProgress,
      });
      setInvoiceId(result.nota.id);
      setView("processing");
      window.setTimeout(() => setView("success"), 900);
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "Não foi possível enviar a nota.",
      );
      setView("error");
    }
  }

  function startAgain() {
    setSelectedProject(null);
    setFile(null);
    setFileError(null);
    setSendError(null);
    setProgress(0);
    setInvoiceId(null);
    setView("projects");
  }

  function backToFile() {
    setSendError(null);
    setView("file");
  }

  const step = view === "projects" ? 1 : view === "file" ? 2 : 3;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.logo} href="/" aria-label="WinfraBR — início">
          <span className={styles.logoMark}>W</span>
          Winfra<span>BR</span>
        </Link>
        <Link className={styles.loginLink} href="/login">Área interna</Link>
      </header>

      <div className={styles.shell}>
        <aside className={styles.intro}>
          <span className={styles.eyebrow}>Auditoria de gastos</span>
          <h1>Envie sua nota<br />com segurança</h1>
          <p>Selecione a obra, anexe o documento e acompanhe o recebimento em poucos passos.</p>
          <div className={styles.securityNote}><span aria-hidden="true">✓</span> Seus arquivos são armazenados de forma privada.</div>
        </aside>

        <section className={styles.card} aria-live="polite">
          <ol className={styles.steps} aria-label="Etapas do envio">
            {["Obra", "Arquivo", "Envio"].map((label, index) => (
              <li className={index + 1 <= step ? styles.stepActive : ""} key={label}>
                <span>{index + 1 < step ? "✓" : index + 1}</span>{label}
              </li>
            ))}
          </ol>

          {view === "projects" ? (
            <div className={styles.view}>
              <div className={styles.heading}><span className={styles.mobileStep}>Passo 1 de 3</span><h2>Selecione a obra</h2><p>Escolha onde esta nota será registrada.</p></div>
              {isLoading ? <ProjectSkeletons /> : null}
              {!isLoading && loadError ? (
                <Feedback title="Não foi possível carregar" message={loadError}>
                  <button className={styles.primaryButton} onClick={() => void loadProjects()} type="button">Tentar novamente</button>
                </Feedback>
              ) : null}
              {!isLoading && !loadError && projects.length === 0 ? (
                <Feedback title="Nenhuma obra disponível" message="Ainda não há obras ativas para receber notas." />
              ) : null}
              {!isLoading && !loadError && projects.length > 0 ? (
                <div className={styles.projectGrid}>
                  {projects.map((project) => (
                    <button className={styles.projectCard} key={project.id} onClick={() => chooseProject(project)} type="button">
                      <span className={styles.projectIcon} aria-hidden="true">⌂</span>
                      <span><strong>{project.nome}</strong><small>{project.local || "Local não informado"}</small></span>
                      <span className={styles.arrow} aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {view === "file" && selectedProject ? (
            <form className={styles.view} onSubmit={handleSubmit}>
              <button className={styles.backButton} onClick={() => setView("projects")} type="button">← Trocar obra</button>
              <div className={styles.heading}><span className={styles.mobileStep}>Passo 2 de 3</span><h2>Adicione a nota</h2><p>Obra selecionada: <strong>{selectedProject.nome}</strong></p></div>
              <div
                className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""} ${fileError ? styles.dropzoneError : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className={styles.fileInput} onChange={handleFileChange} ref={inputRef} type="file" />
                {file ? (
                  <div className={styles.selectedFile}>
                    <span className={styles.fileIcon} aria-hidden="true">▤</span>
                    <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                    <button aria-label="Remover arquivo" onClick={() => setFile(null)} type="button">×</button>
                  </div>
                ) : (
                  <>
                    <span className={styles.uploadIcon} aria-hidden="true">↑</span>
                    <strong>Arraste o arquivo para cá</strong>
                    <span>ou</span>
                    <button className={styles.selectButton} onClick={() => inputRef.current?.click()} type="button">Selecionar arquivo</button>
                    <small>PDF, JPG ou PNG • máximo de 10 MB</small>
                  </>
                )}
              </div>
              {fileError ? <p className={styles.fieldError} role="alert">{fileError}</p> : null}
              <div className={styles.tips}><strong>Para uma leitura melhor:</strong><span>Use uma imagem nítida, bem iluminada e com a nota inteira visível.</span></div>
              <button className={styles.primaryButton} disabled={!file} type="submit">Enviar nota <span aria-hidden="true">→</span></button>
            </form>
          ) : null}

          {view === "sending" ? (
            <StatusView icon="upload" title="Enviando sua nota" description="Mantenha esta página aberta até o arquivo ser recebido.">
              <div className={styles.progressTrack}><span style={{ width: `${progress}%` }} /></div>
              <strong className={styles.progressLabel}>{progress}% enviado</strong>
            </StatusView>
          ) : null}

          {view === "processing" ? (
            <StatusView icon="processing" title="Arquivo recebido" description="Estamos preparando a nota para análise.">
              <ul className={styles.processingList}><li className={styles.complete}>✓ Upload concluído</li><li><span className={styles.dotPulse} /> Preparando processamento</li></ul>
            </StatusView>
          ) : null}

          {view === "success" && selectedProject && file ? (
            <StatusView icon="success" title="Nota recebida com sucesso!" description="O arquivo foi armazenado e seguirá para análise. Você já pode sair desta página.">
              <dl className={styles.summary}><div><dt>Obra</dt><dd>{selectedProject.nome}</dd></div><div><dt>Arquivo</dt><dd>{file.name}</dd></div>{invoiceId ? <div><dt>Protocolo</dt><dd>{invoiceId}</dd></div> : null}</dl>
              <button className={styles.primaryButton} onClick={startAgain} type="button">Enviar outra nota</button>
            </StatusView>
          ) : null}

          {view === "error" ? (
            <StatusView icon="error" title="O envio não foi concluído" description={sendError || "Houve uma falha técnica durante o envio. Seu arquivo não foi registrado."}>
              <button className={styles.primaryButton} onClick={backToFile} type="button">Tentar novamente</button>
              <button className={styles.secondaryButton} onClick={startAgain} type="button">Voltar ao início</button>
            </StatusView>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ProjectSkeletons() {
  return <div className={styles.projectGrid} aria-label="Carregando obras">{[1, 2, 3].map((item) => <div className={styles.skeleton} key={item} />)}</div>;
}

function Feedback({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return <div className={styles.feedback}><span aria-hidden="true">!</span><h3>{title}</h3><p>{message}</p>{children}</div>;
}

function StatusView({ icon, title, description, children }: { icon: "upload" | "processing" | "success" | "error"; title: string; description: string; children: React.ReactNode }) {
  const symbols = { upload: "↑", processing: "◌", success: "✓", error: "!" };
  return <div className={styles.statusView}><span className={`${styles.statusIcon} ${styles[icon]}`} aria-hidden="true">{symbols[icon]}</span><h2>{title}</h2><p>{description}</p>{children}</div>;
}

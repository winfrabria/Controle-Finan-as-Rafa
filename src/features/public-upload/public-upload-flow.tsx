"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE_BYTES, PUBLIC_UPLOAD_ENDPOINTS, type ProjectOption, type ProjectsResponse } from "./api-contract";
import { uploadInvoice } from "./upload-api";
import styles from "./public-upload.module.css";

type View = "form" | "sending" | "processing" | "success" | "error";

function formatBytes(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
}

function validateFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const validExtension = extension && ["pdf", "jpg", "jpeg", "png"].includes(extension);
  const validType = ACCEPTED_FILE_TYPES.includes(file.type as (typeof ACCEPTED_FILE_TYPES)[number]);
  if (!validType || !validExtension) return "Envie um arquivo PDF, JPG ou PNG.";
  if (file.size > MAX_FILE_SIZE_BYTES) return `O arquivo deve ter no máximo ${formatBytes(MAX_FILE_SIZE_BYTES)}.`;
  if (file.size === 0) return "O arquivo selecionado está vazio.";
  return null;
}

async function requestProjects() {
  const response = await fetch(PUBLIC_UPLOAD_ENDPOINTS.projects, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error();
  const payload = (await response.json()) as ProjectsResponse;
  if (!Array.isArray(payload.obras)) throw new Error();
  return payload.obras;
}

function Brand() {
  return <span className={styles.brand}><span className={styles.brandMark}>W</span><strong>Winfra<span>BR</span></strong></span>;
}

export function PublicUploadFlow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("form");
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
    setIsLoading(true); setLoadError(null);
    try { setProjects(await requestProjects()); } catch { setLoadError("Não foi possível carregar as obras agora."); } finally { setIsLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void requestProjects()
      .then((result) => { if (active) setProjects(result); })
      .catch(() => { if (active) setLoadError("Não foi possível carregar as obras agora."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const error = validateFile(nextFile); setFileError(error); setFile(error ? null : nextFile);
  }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) { chooseFile(event.target.files?.[0]); event.target.value = ""; }
  function handleDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setIsDragging(false); chooseFile(event.dataTransfer.files?.[0]); }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) { setFileError("Selecione uma obra antes de enviar."); return; }
    if (!file) { setFileError("Selecione um arquivo antes de enviar."); return; }
    setProgress(0); setSendError(null); setView("sending");
    try {
      const result = await uploadInvoice({ projectId: selectedProject.id, file, onProgress: setProgress });
      setInvoiceId(result.nota.id); setView("processing"); window.setTimeout(() => setView("success"), 900);
    } catch (error) { setSendError(error instanceof Error ? error.message : "Não foi possível enviar a nota."); setView("error"); }
  }

  function startAgain() { setSelectedProject(null); setFile(null); setFileError(null); setSendError(null); setProgress(0); setInvoiceId(null); setView("form"); }

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" aria-label="WinfraBR — início"><Brand /></Link><Link className={styles.loginLink} href="/login"><span>↪</span> Voltar para login</Link></header>
    <div className={styles.content}>
      <section className={styles.mainColumn}>
        <div className={styles.titleBlock}><h1>Enviar nota fiscal</h1><p>Envie sua nota fiscal para análise sem precisar fazer login.<br />Rápido, seguro e sem complicação.</p></div>
        <ol className={styles.stepper}><li className={styles.active}><span>1</span>Selecione a obra</li><li><span>2</span>Envie sua nota fiscal</li><li><span>3</span>Conclusão</li></ol>
        <section className={styles.formCard} aria-live="polite">
          {view === "form" ? <form onSubmit={handleSubmit}>
            <h2>1. Selecione a obra</h2><label className={styles.label} htmlFor="project">Obra <b>*</b></label>
            <div className={styles.selectWrap}><span>▥</span><select id="project" disabled={isLoading} value={selectedProject?.id ?? ""} onChange={(event) => { setSelectedProject(projects.find((item) => item.id === event.target.value) ?? null); setFileError(null); }}><option value="">{isLoading ? "Carregando obras..." : "Selecione a obra"}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.nome}{project.local ? ` — ${project.local}` : ""}</option>)}</select></div>
            {loadError ? <p className={styles.fieldError}>{loadError} <button type="button" onClick={() => void loadProjects()}>Tentar novamente</button></p> : null}
            <div className={styles.divider} />
            <h2>2. Envie sua nota fiscal</h2><p className={styles.helper}>Envie apenas 1 nota por vez. Formatos aceitos: PDF, JPG, PNG.</p>
            <div className={`${styles.dropzone} ${isDragging ? styles.dragging : ""}`} onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}>
              <input ref={inputRef} type="file" className={styles.fileInput} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={handleFileChange} />
              <span className={styles.uploadCircle}>↥</span><p><strong>Clique para selecionar</strong> ou arraste o arquivo aqui</p><small>Tamanho máximo: 10 MB • Apenas 1 arquivo por envio</small>
            </div>
            {file ? <div className={styles.fileRow}><span className={styles.pdfIcon}>{file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}</span><span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span><i>✓</i><button type="button" aria-label="Remover arquivo" onClick={() => setFile(null)}>×</button></div> : null}
            {fileError ? <p className={styles.fieldError} role="alert">{fileError}</p> : null}
            <button className={styles.submit} type="submit" disabled={!selectedProject || !file}><span>↥</span> Enviar nota fiscal</button>
            <p className={styles.lockNote}>▣ <span>Não é necessário login. Seus dados estão protegidos com criptografia de ponta a ponta.</span></p>
          </form> : null}
          {view === "sending" ? <Status icon="↥" title="Enviando sua nota" text="Mantenha esta página aberta até o arquivo ser recebido."><div className={styles.progress}><span style={{ width: `${progress}%` }} /></div><strong>{progress}% enviado</strong></Status> : null}
          {view === "processing" ? <Status icon="◌" title="Arquivo recebido" text="Estamos preparando a nota para análise."><p className={styles.ok}>✓ Upload concluído</p><p className={styles.pulsing}>● Preparando processamento</p></Status> : null}
          {view === "success" ? <Status icon="✓" title="Nota recebida com sucesso!" text="O arquivo foi armazenado e seguirá para análise."><div className={styles.summary}><b>Obra</b><span>{selectedProject?.nome}</span><b>Arquivo</b><span>{file?.name}</span>{invoiceId ? <><b>Protocolo</b><span>{invoiceId}</span></> : null}</div><button className={styles.submit} onClick={startAgain}>Enviar outra nota</button></Status> : null}
          {view === "error" ? <Status icon="!" title="O envio não foi concluído" text={sendError || "Houve uma falha técnica durante o envio."}><button className={styles.submit} onClick={() => setView("form")}>Tentar novamente</button></Status> : null}
        </section>
      </section>
      <aside className={styles.sidebar}>
        <section className={styles.infoCard}><h2>Como funciona</h2>{[["▥","1. Selecione a obra","Escolha a obra relacionada à nota fiscal que você deseja enviar."],["↥","2. Envie sua nota fiscal","Faça o upload da 1 nota fiscal por vez. Formatos aceitos: PDF, JPG, PNG."],["♢","3. Análise e retorno","Nossa equipe analisará sua nota e entrará em contato caso seja necessário."]].map(([icon,title,text]) => <div className={styles.infoRow} key={title}><span>{icon}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</section>
        <section className={`${styles.infoCard} ${styles.security}`}><h2>Segurança e privacidade</h2><div className={styles.infoRow}><span>♢</span><p>Suas informações e documentos são tratados com total segurança e confidencialidade. Utilizamos criptografia de ponta a ponta e seguimos a LGPD.</p></div></section>
        <section className={styles.notice}><span>ⓘ</span><div><strong>Este envio não requer login.</strong><p>Se for necessário acompanhar o status, nossa equipe entrará em contato pelos dados informados na nota.</p></div></section>
      </aside>
    </div>
    <footer className={styles.footer}><p>♢ <span>Ambiente seguro e em conformidade com a LGPD</span><i />▣ <span>Seus dados estão protegidos com criptografia de ponta a ponta.</span></p><p>© 2024 <strong>WinfraBR.</strong> Todos os direitos reservados.</p></footer>
  </main>;
}

function Status({ icon, title, text, children }: { icon: string; title: string; text: string; children: React.ReactNode }) {
  return <div className={styles.status}><span className={styles.statusIcon}>{icon}</span><h2>{title}</h2><p>{text}</p>{children}</div>;
}

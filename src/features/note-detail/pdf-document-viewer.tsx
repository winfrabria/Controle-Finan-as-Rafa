"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import styles from "./note-detail.module.css";

/** Render the actual file, without depending on a browser PDF plug-in. */
export function PdfDocumentViewer({ url, title }: { url: string; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [canLoad, setCanLoad] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // Desktop and mobile shells coexist in the DOM. Do not download and
      // render a second copy inside the shell currently hidden by CSS.
      if (entry.contentRect.width <= 0) return;
      setWidth(Math.max(200, entry.contentRect.width - 24));
      setCanLoad(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!canLoad) return;
    let disposed = false;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    void (async () => {
      try {
        const engine = await import("pdfjs-dist");
        if (disposed) return;
        engine.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        task = engine.getDocument({ url, disableRange: true, enableXfa: false });
        const document = await task.promise;
        if (!disposed) { setPdf(document); setPage(1); }
      } catch { if (!disposed) setState("error"); }
    })();
    return () => { disposed = true; void task?.destroy(); };
  }, [url, canLoad]);
  useEffect(() => {
    if (!pdf) return;
    let disposed = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    void (async () => {
      try {
        const source = await pdf.getPage(page);
        if (disposed || !canvas.current) return;
        const scale = width / source.getViewport({ scale: 1 }).width * zoom;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = source.getViewport({ scale: scale * ratio });
        const target = canvas.current;
        target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
        target.style.width = `${viewport.width / ratio}px`; target.style.height = `${viewport.height / ratio}px`;
        render = source.render({ canvas: target, viewport });
        await render.promise;
        if (!disposed) setState("ready");
      } catch { if (!disposed) setState("error"); }
    })();
    return () => { disposed = true; render?.cancel(); };
  }, [pdf, page, width, zoom]);
  return <div ref={container} className={styles.pdfViewer}>
    <div className={styles.pdfControls} aria-label="Navegação do PDF">
      <button type="button" disabled={!pdf || page <= 1} onClick={() => { setState("loading"); setPage(p => p - 1); }}>Página anterior</button>
      <span aria-live="polite">Página {page} de {pdf?.numPages ?? "…"}</span>
      {pdf && <select aria-label="Ir para página do PDF" value={page} onChange={event => { setState("loading"); setPage(Number(event.target.value)); }}>
        {Array.from({length:pdf.numPages}, (_,index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select>}
      <button type="button" disabled={!pdf || page >= pdf.numPages} onClick={() => { setState("loading"); setPage(p => p + 1); }}>Próxima página</button>
      <button type="button" aria-label="Diminuir zoom" disabled={zoom <= 0.7} onClick={() => setZoom(z => Math.max(0.7, z - 0.1))}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Aumentar zoom" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2, z + 0.1))}>+</button>
    </div>
    <div className={styles.pdfPages}>
      {state === "loading" && <p role="status">Carregando página do documento…</p>}
      {state === "error" && <div role="alert" className={styles.documentUnavailable}>
        <strong>Não foi possível exibir o PDF.</strong>
        <span>Recarregue a página para renovar o acesso ao arquivo.</span>
        <button type="button" onClick={() => window.location.reload()}>Renovar acesso e tentar novamente</button>
        <a href={url} target="_blank" rel="noreferrer">Abrir arquivo original</a>
      </div>}
      <canvas ref={canvas} role="img" aria-label={`${title}, página ${page}`} hidden={state === "error"} />
    </div>
  </div>;
}

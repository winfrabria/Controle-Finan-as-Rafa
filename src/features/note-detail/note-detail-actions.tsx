"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/features/workspace-ui/ui-icons";

import styles from "./note-detail.module.css";

export function NoteDetailActions() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className={styles.headerActions} ref={rootRef}>
      <button type="button" onClick={() => window.print()}>
        <Icon name="document" /> Imprimir
      </button>
      <div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          Mais ações <Icon name="chevron" />
        </button>
        {open ? (
          <menu>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(window.location.href);
                setOpen(false);
              }}
            >
              Copiar link da nota
            </button>
            <button type="button" onClick={() => window.print()}>
              Salvar como PDF
            </button>
          </menu>
        ) : null}
      </div>
    </div>
  );
}

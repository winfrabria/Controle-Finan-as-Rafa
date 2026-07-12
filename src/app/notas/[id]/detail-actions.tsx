"use client";

import { useState } from "react";

import styles from "./detail.module.css";

export function DetailActions() {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.actions}>
      <button type="button" onClick={() => window.print()}>
        ▣ &nbsp; Imprimir
      </button>
      <div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Mais ações⌄
        </button>
        {open ? (
          <menu>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(window.location.href)
              }
            >
              Copiar link
            </button>
            <button
              type="button"
              onClick={() =>
                window.scrollTo({
                  top: document.body.scrollHeight,
                  behavior: "smooth",
                })
              }
            >
              Ir para atualização
            </button>
          </menu>
        ) : null}
      </div>
    </div>
  );
}

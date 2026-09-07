"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./note-detail.module.css";

export function NoteReadAction({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function markAsRead() {
    if (state === "saving" || state === "saved") return;

    setState("saving");
    try {
      const response = await fetch(`/api/notas/${noteId}/read`, {
        headers: { Accept: "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        setState("error");
        return;
      }

      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className={styles.desktopReadAction}>
      <button
        disabled={state === "saving" || state === "saved"}
        onClick={markAsRead}
        type="button"
      >
        <span aria-hidden="true">✓</span>
        {state === "saving"
          ? "Marcando como lida…"
          : state === "saved"
            ? "Nota marcada como lida"
            : "Marcar como lida"}
      </button>
      {state === "error" ? (
        <p role="alert">Não foi possível marcar a nota como lida. Tente novamente.</p>
      ) : null}
    </div>
  );
}

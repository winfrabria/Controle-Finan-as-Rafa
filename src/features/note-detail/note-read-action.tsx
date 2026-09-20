"use client";

import styles from "./note-detail.module.css";
import { useNoteRead } from "./use-note-read";

export function NoteReadAction({ noteId, noteVersion, isRead }: { noteId: string; noteVersion: number; isRead: boolean }) {
  const { readState, readError, markAsRead } = useNoteRead(noteId, noteVersion, isRead);

  return (
    <div className={styles.desktopReadAction}>
      <button
        disabled={readState !== "idle"}
        onClick={markAsRead}
        type="button"
      >
        <span aria-hidden="true">✓</span>
        {readState === "loading"
          ? "Marcando como lida…"
          : readState === "done"
            ? "Nota marcada como lida"
            : "Marcar como lida"}
      </button>
      {readError ? (
        <p role="alert">{readError}</p>
      ) : null}
    </div>
  );
}

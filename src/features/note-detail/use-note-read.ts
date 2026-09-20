"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";
import { requestNoteRead } from "./note-read-request";

export function useNoteRead(noteId: string, noteVersion: number, isRead: boolean) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const readState = isRead ? "done" : state;
  async function markAsRead() {
    if (readState !== "idle") return;
    const endCriticalActivity = beginPwaCriticalActivity();
    setState("loading");
    setError(null);
    try {
      await requestNoteRead(noteId, noteVersion);
      setState("done");
      router.refresh();
    } catch (failure) {
      setState("idle");
      setError(failure instanceof Error && failure.name !== "TimeoutError"
        ? failure.message : "Não foi possível confirmar a leitura a tempo. Tente novamente.");
    } finally {
      endCriticalActivity();
    }
  }
  return { readState, readError: error, markAsRead };
}

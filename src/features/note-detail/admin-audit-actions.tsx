"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/features/workspace-ui/ui-icons";

import type { AdminNoteAiRun } from "./data";
import { formatDateTime } from "./note-detail-format";
import styles from "./admin-comparative-audit.module.css";

type Props = {
  isDemo: boolean;
  latestRun: AdminNoteAiRun | null;
  noteId: string;
};

export function AdminAuditActions({ isDemo, latestRun, noteId }: Props) {
  const [open, setOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function reprocess() {
    setOpen(false);
    if (isDemo) {
      setFeedback("A nota de demonstração não pode ser reprocessada.");
      return;
    }
    if (!window.confirm("Reprocessar esta nota com a política atual?")) return;
    setReprocessing(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/notas/${noteId}/reprocess`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { erro?: { mensagem?: string }; job?: { id: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.erro?.mensagem ?? "Não foi possível reprocessar a nota.",
        );
      }
      setFeedback("Reprocessamento agendado com sucesso.");
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Não foi possível reprocessar a nota.",
      );
    } finally {
      setReprocessing(false);
    }
  }

  return (
    <>
      <div className={styles.actionArea} ref={rootRef}>
        <button
          className={styles.moreActions}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          Mais ações <Icon name="chevron" />
        </button>
        {open ? (
          <div className={styles.actionMenu}>
            <button type="button" disabled={reprocessing} onClick={reprocess}>
              <Icon name="clock" />
              {reprocessing ? "Agendando..." : "Reprocessar nota"}
            </button>
            <Link href={`/admin/logs?noteId=${encodeURIComponent(noteId)}`}>
              <Icon name="document" /> Ver logs da IA
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCostOpen(true);
              }}
            >
              <Icon name="money" /> Ver custo do processamento
            </button>
          </div>
        ) : null}
        {feedback ? <p className={styles.actionFeedback}>{feedback}</p> : null}
      </div>

      {costOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCostOpen(false);
          }}
        >
          <section
            className={styles.costModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cost-title"
          >
            <header>
              <div>
                <h2 id="cost-title">Custo do processamento</h2>
                <p>Última execução de IA vinculada a esta nota.</p>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setCostOpen(false)}
              >
                ×
              </button>
            </header>
            {latestRun ? (
              <dl>
                <div><dt>Modelo</dt><dd>{latestRun.model}</dd></div>
                <div><dt>Esforço</dt><dd>{latestRun.reasoningEffort}</dd></div>
                <div><dt>Tokens</dt><dd>{latestRun.totalTokens?.toLocaleString("pt-BR") ?? "Não informado"}</dd></div>
                <div><dt>Custo</dt><dd>{formatUsd(latestRun.costUsd)}</dd></div>
                <div><dt>Latência</dt><dd>{latestRun.latencyMs ? `${latestRun.latencyMs.toLocaleString("pt-BR")} ms` : "Não informada"}</dd></div>
                <div><dt>Execução</dt><dd>{formatDateTime(latestRun.createdAt)}</dd></div>
                <div><dt>Status</dt><dd>{latestRun.status}</dd></div>
                <div><dt>Política</dt><dd>{latestRun.policyVersion}</dd></div>
              </dl>
            ) : (
              <p className={styles.noRun}>Nenhuma execução de IA registrada.</p>
            )}
            <Link href={`/admin/logs?noteId=${encodeURIComponent(noteId)}`}>
              Abrir logs completos
            </Link>
          </section>
        </div>
      ) : null}
    </>
  );
}

function formatUsd(value: string | null) {
  if (!value) return "Não informado";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("pt-BR", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 4,
    style: "currency",
  }).format(amount);
}

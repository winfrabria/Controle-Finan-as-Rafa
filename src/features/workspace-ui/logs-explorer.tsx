"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "./ui-icons";
import { StatusBadge } from "./portal-shell";
import styles from "./workspace-ui.module.css";

export type LogClassification =
  | "Análise incompleta"
  | "Falha de leitura"
  | "Falha de processamento"
  | "OK"
  | "Precisa de informação"
  | "Processamento"
  | "Suspeita";

export type AuditLog = {
  id: string;
  at: string;
  dateIso: string;
  user: string;
  noteNumber: string;
  noteId?: string;
  action: string;
  classification: LogClassification;
  reason: string;
  work: string;
  status: string;
  comment: string;
  technical?: {
    costUsd?: string;
    error?: string;
    explanation?: string;
    effort?: string;
    latencyMs?: number;
    model?: string;
    policyVersion?: string;
    promptVersion?: string;
    response?: string;
    steps?: string[];
    tokens?: number;
  };
};

function tone(classification: LogClassification) {
  if (classification === "OK") return "ok" as const;
  if (
    classification === "Falha de leitura" ||
    classification === "Falha de processamento"
  ) {
    return "danger" as const;
  }
  if (
    classification === "Precisa de informação" ||
    classification === "Processamento"
  ) {
    return "info" as const;
  }
  return "warning" as const;
}

export function LogsExplorer({
  logs,
  noteFilterLabel,
}: {
  logs: AuditLog[];
  noteFilterLabel?: string;
}) {
  const [selectedId, setSelectedId] = useState(logs[0]?.id ?? "");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [user, setUser] = useState("");
  const [work, setWork] = useState("");
  const [classification, setClassification] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobileDetailOpen || !window.matchMedia("(max-width: 760px)").matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    detailRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileDetailOpen(false);
        previousFocusRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !detailRef.current) return;
      const focusable = Array.from(
        detailRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        detailRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileDetailOpen]);

  const users = useMemo(
    () => [...new Set(logs.map((log) => log.user))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [logs],
  );
  const classifications = useMemo(
    () => [...new Set(logs.map((log) => log.classification))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [logs],
  );

  const filtered = useMemo(
    () =>
      logs.filter((log) => {
        const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
        const searchable = [
          log.noteNumber,
          log.action,
          log.reason,
          log.status,
          log.work,
          log.comment,
        ]
          .join(" ")
          .toLocaleLowerCase("pt-BR");
        return (
          (!normalizedQuery || searchable.includes(normalizedQuery)) &&
          (!user || log.user === user) &&
          (!work || log.work === work) &&
          (!classification || log.classification === classification) &&
          (!startDate || log.dateIso >= startDate) &&
          (!endDate || log.dateIso <= endDate)
        );
      }),
    [classification, endDate, logs, query, startDate, user, work],
  );
  const selected =
    filtered.find((log) => log.id === selectedId) ?? filtered[0];

  function clearFilters() {
    setUser("");
    setWork("");
    setClassification("");
    setQuery("");
    setStartDate("");
    setEndDate("");
  }

  function selectLog(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 760px)").matches) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setMobileDetailOpen(true);
    }
  }

  function closeMobileDetail() {
    setMobileDetailOpen(false);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }

  return (
    <section className={styles.logsLayout}>
      <article>
        {noteFilterLabel ? (
          <div className={styles.activeLogContext}>
            <span><Icon name="document" /></span>
            <div>
              <strong>Logs filtrados por anexo</strong>
              <p>{noteFilterLabel}</p>
            </div>
            <Link href="/admin/logs">Ver todos os logs</Link>
          </div>
        ) : null}
        <form
          className={styles.filterBar}
          data-mobile-open={mobileFiltersOpen}
          onSubmit={(e) => e.preventDefault()}
        >
          <label className={styles.logSearchField}>
            Buscar no histórico
            <span>
              <Icon name="search" />
              <input
                aria-label="Buscar por nota, ação, motivo ou obra"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nota, ação, motivo ou obra"
                value={query}
              />
            </span>
          </label>
          <button
            aria-controls="log-secondary-filters"
            aria-expanded={mobileFiltersOpen}
            className={styles.mobileLogFilterToggle}
            onClick={() => setMobileFiltersOpen((current) => !current)}
            type="button"
          >
            <Icon name="filter" />
            {mobileFiltersOpen ? "Ocultar filtros" : "Filtros"}
            {user || work || classification || startDate || endDate ? (
              <span aria-label="Filtros ativos">●</span>
            ) : null}
          </button>
          <fieldset
            className={`${styles.periodFieldset} ${styles.logFilterSecondary}`}
            id="log-secondary-filters"
          >
            <legend>Período</legend>
            <div>
              <Icon name="calendar" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Data inicial"
              />
              <span>até</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Data final"
              />
            </div>
          </fieldset>
          <label className={styles.logFilterSecondary}>
            Usuário
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Todos</option>
              {users.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className={styles.logFilterSecondary}>
            Obra
            <select value={work} onChange={(e) => setWork(e.target.value)}>
              <option value="">Todas as obras</option>
              {[...new Set(logs.map((log) => log.work))].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className={styles.logFilterSecondary}>
            Classificação
            <select
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
            >
              <option value="">Todas</option>
              {classifications.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button
            className={styles.logFilterSecondary}
            type="button"
            onClick={clearFilters}
          >
            <Icon name="filter" /> Limpar filtros
          </button>
        </form>
        <div className={styles.panel}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Data/hora</th>
                <th>Usuário</th>
                <th>Nº da nota</th>
                <th>Ação</th>
                <th>Classificação</th>
                <th>Motivo</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr
                  key={log.id}
                  aria-selected={selected?.id === log.id}
                  className={
                    selected?.id === log.id ? styles.selectedTableRow : undefined
                  }
                  onClick={() => selectLog(log.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectLog(log.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <td>{log.at}</td>
                  <td>
                    <span className={styles.miniAvatar}>{log.user[0]}</span>
                    {log.user}
                  </td>
                  <td>
                    <button
                      className={styles.inlineLogButton}
                      type="button"
                      onClick={() => selectLog(log.id)}
                    >
                      {log.noteNumber}
                    </button>
                  </td>
                  <td>{log.action}</td>
                  <td>
                    <StatusBadge tone={tone(log.classification)}>
                      {log.classification}
                    </StatusBadge>
                  </td>
                  <td>{log.reason}</td>
                  <td>{log.status}</td>
                  <td>
                    <Link
                      className={styles.eyeButton}
                      aria-label={`Ver log ${log.id}`}
                      href={`/admin/logs/${encodeURIComponent(log.id)}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Icon name="eye" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.mobileCardsList}>
            {filtered.map((log) => (
              <button
                type="button"
                onClick={() => selectLog(log.id)}
                className={`${styles.logMobileCard} ${selected?.id === log.id ? styles.selectedLog : ""}`}
                key={log.id}
              >
                <strong>{log.at}</strong>
                <span>
                  {log.user}
                  <br />
                  {log.noteNumber}
                </span>
                <StatusBadge tone={tone(log.classification)}>
                  {log.classification}
                </StatusBadge>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <section className={styles.emptyState}>
              <Icon name="document" />
              <h2>Nenhum log encontrado</h2>
              <p>Ajuste ou limpe os filtros para voltar a visualizar os eventos.</p>
            </section>
          ) : null}
          <footer className={styles.pagination}>
            <span>
              {filtered.length === 0 ? "0" : `1-${filtered.length}`} de {logs.length}
            </span>
            <span>Mostrando resultados filtrados</span>
          </footer>
        </div>
      </article>
      {selected && mobileDetailOpen ? (
        <div
          className={styles.logDetailBackdrop}
          onMouseDown={closeMobileDetail}
          role="presentation"
        />
      ) : null}
      {selected ? <aside
        className={`${styles.panel} ${styles.logDetail}`}
        data-mobile-open={mobileDetailOpen}
        aria-labelledby="log-detail-title"
        aria-modal={mobileDetailOpen ? "true" : undefined}
        ref={detailRef}
        role={mobileDetailOpen ? "dialog" : undefined}
        tabIndex={mobileDetailOpen ? -1 : undefined}
      >
        <div className={styles.panelHeader}>
          <h2 id="log-detail-title">Detalhes do log</h2>
          <div className={styles.logDetailActions}>
            <StatusBadge tone={tone(selected.classification)}>
              {selected.classification}
            </StatusBadge>
            <button
              type="button"
              aria-label="Fechar detalhes"
              onClick={closeMobileDetail}
            >
              ×
            </button>
          </div>
        </div>
        <dl>
          <div>
            <dt>Data/hora</dt>
            <dd>{selected.at}</dd>
          </div>
          <div>
            <dt>Usuário</dt>
            <dd>{selected.user}</dd>
          </div>
          <div>
            <dt>Nº da nota</dt>
            <dd>{selected.noteNumber}</dd>
          </div>
          <div>
            <dt>Obra</dt>
            <dd>{selected.work}</dd>
          </div>
          <div>
            <dt>Ação</dt>
            <dd>{selected.action}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{selected.status}</dd>
          </div>
        </dl>
        <h3>Explicação / comentário</h3>
        <p className={styles.comment}>{selected.comment}</p>
        <h3>Motivo da classificação</h3>
        <p className={styles.comment}>{selected.reason}</p>
        {selected.noteId ? (
          <Link className={styles.logNoteLink} href={`/notas/${selected.noteId}`}>
            Abrir anexo relacionado <Icon name="chevron" />
          </Link>
        ) : null}
        <Link
          className={styles.logFullLink}
          href={`/admin/logs/${encodeURIComponent(selected.id)}`}
        >
          Abrir log técnico completo <Icon name="chevron" />
        </Link>
        <h3>Linha do tempo</h3>
        <ol className={styles.timeline}>
          <li>
            <b>{selected.at}</b>
            {selected.action}
          </li>
        </ol>
        {selected.technical ? (
          <>
            {selected.technical.explanation ? (
              <>
                <h3>O que o Harness fez</h3>
                <p className={styles.comment}>{selected.technical.explanation}</p>
              </>
            ) : null}
            {selected.technical.steps?.length ? (
              <>
                <h3>Etapas desta execução</h3>
                <ol className={styles.harnessSteps}>
                  {selected.technical.steps.map((step, index) => (
                    <li key={`${selected.id}-step-${index}`}>{step}</li>
                  ))}
                </ol>
              </>
            ) : null}
            <h3>Execução técnica</h3>
            <dl>
              {selected.technical.model ? <div><dt>Modelo</dt><dd>{selected.technical.model}</dd></div> : null}
              {selected.technical.effort ? <div><dt>Esforço</dt><dd>{selected.technical.effort}</dd></div> : null}
              {selected.technical.tokens !== undefined ? <div><dt>Tokens</dt><dd>{selected.technical.tokens}</dd></div> : null}
              {selected.technical.costUsd ? <div><dt>Custo</dt><dd>US$ {selected.technical.costUsd}</dd></div> : null}
              {selected.technical.latencyMs !== undefined ? <div><dt>Latência</dt><dd>{selected.technical.latencyMs} ms</dd></div> : null}
              {selected.technical.policyVersion ? <div><dt>Política</dt><dd>{selected.technical.policyVersion}</dd></div> : null}
              {selected.technical.promptVersion ? <div><dt>Prompt</dt><dd>{selected.technical.promptVersion}</dd></div> : null}
              {selected.technical.error ? <div><dt>Falha segura</dt><dd>{selected.technical.error}</dd></div> : null}
            </dl>
            {selected.technical.response ? (
              <details className={styles.rawLogDetails}>
                <summary>Dados estruturados da execução</summary>
                <pre>{selected.technical.response}</pre>
              </details>
            ) : null}
          </>
        ) : null}
        <small className={styles.logId}>ID do log: {selected.id}</small>
      </aside> : null}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import { PortalShell, type PortalRole } from "./portal-shell";
import type { ReviewerDashboardNote } from "./reviewer-dashboard-types";
import styles from "./reviewer-dashboard-view.module.css";

type ReviewerDashboardViewProps = {
  role: PortalRole;
  userEmail?: string;
  works?: { id: string; name: string }[];
  notes?: ReviewerDashboardNote[];
};

type DashboardNote = ReviewerDashboardNote;

function parseMoney(value: string) {
  const normalized = value
    .replace(/R\$\s?/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function dateInputKey(value: string) {
  const parts = value.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}

function periodLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function previousPeriod(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return null;
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function statusClass(classification: DashboardNote["classification"]) {
  if (classification === "Suspeita") return styles.statusSuspicious;
  if (classification === "Em análise" || classification === "Sem parâmetro") {
    return styles.statusProcessing;
  }
  if (classification === "Falha de leitura" || classification === "Falha de processamento") {
    return styles.statusFailed;
  }
  return styles.statusOk;
}

function comparison(current: number, previous: number) {
  if (previous === 0 && current > 0) {
    return {
      arrow: "↑",
      label: "Novo",
      tone: "positive" as const,
    };
  }
  const value =
    previous === 0
      ? current === 0
        ? 0
        : 100
      : ((current - previous) / previous) * 100;
  const rounded = Math.abs(value).toFixed(1).replace(".", ",");
  return {
    arrow: value >= 0 ? "↑" : "↓",
    label: `${rounded}%`,
    tone: value >= 0 ? ("positive" as const) : ("negative" as const),
  };
}

export function ReviewerDashboardView({
  notes = [],
  role,
  userEmail,
  works = [],
}: ReviewerDashboardViewProps) {
  const [work, setWork] = useState("");
  const periodOptions = useMemo(
    () =>
      [...new Set(notes.map((note) => note.dateKey))]
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a)),
    [notes],
  );
  const defaultPeriod = periodOptions[0] ?? "todos";
  const [period, setPeriod] = useState(defaultPeriod);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState("");

  const workOptions = useMemo(
    () =>
      [...new Set([...works.map((item) => item.name), ...notes.map((item) => item.work)])].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [notes, works],
  );

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return notes.filter((note) => {
      const matchesWork = !work || note.work === work;
      const matchesQuery =
        !normalizedQuery ||
        note.number.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        note.supplier.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      const hasCustomRange = Boolean(dateFrom || dateTo);
      const noteDate = dateInputKey(note.date);
      const matchesPeriod =
        hasCustomRange ||
        period === "todos" ||
        note.dateKey === period;
      const matchesDateRange =
        (!dateFrom || (noteDate && noteDate >= dateFrom)) &&
        (!dateTo || (noteDate && noteDate <= dateTo));
      return matchesWork && matchesQuery && matchesPeriod && matchesDateRange;
    });
  }, [dateFrom, dateTo, notes, period, query, work]);

  const comparisonNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return notes.filter((note) => {
      const matchesWork = !work || note.work === work;
      const matchesQuery =
        !normalizedQuery ||
        note.number.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        note.supplier.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      return matchesWork && matchesQuery;
    });
  }, [notes, query, work]);

  const periodComparisonNotes = useMemo(() => {
    const previous = previousPeriod(period);
    if (!previous || period === "todos" || dateFrom || dateTo) return [];
    return comparisonNotes.filter((note) => note.dateKey === previous);
  }, [comparisonNotes, dateFrom, dateTo, period]);

  const metrics = useMemo(() => {
    const received = filteredNotes.length;
    const suspicious = filteredNotes.filter(
      (note) => note.classification === "Suspeita",
    ).length;
    const processing = filteredNotes.filter(
      (note) =>
        note.classification === "Em análise" ||
        note.classification === "Falha de processamento",
    ).length;
    const total = filteredNotes.reduce((sum, note) => sum + parseMoney(note.value), 0);
    const previousReceived = periodComparisonNotes.length;
    const previousSuspicious = periodComparisonNotes.filter(
      (note) => note.classification === "Suspeita",
    ).length;
    const previousProcessing = periodComparisonNotes.filter(
      (note) =>
        note.classification === "Em análise" ||
        note.classification === "Falha de processamento",
    ).length;
    const previousTotal = periodComparisonNotes.reduce(
      (sum, note) => sum + parseMoney(note.value),
      0,
    );
    return {
      deltas: {
        processing: comparison(processing, previousProcessing),
        received: comparison(received, previousReceived),
        suspicious: comparison(suspicious, previousSuspicious),
        total: comparison(total, previousTotal),
      },
      processing,
      received,
      suspicious,
      total,
    };
  }, [filteredNotes, periodComparisonNotes]);

  const causes = useMemo(() => {
    const counts = new Map<string, number>();
    filteredNotes.forEach((note) => {
      note.reasons.forEach((reason) => {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      });
    });
    const total = Math.max(
      1,
      [...counts.values()].reduce((sum, count) => sum + count, 0),
    );
    return [...counts.entries()]
      .map(([label, count]) => ({
        count,
        label,
        percentage: Math.round((count / total) * 100),
      }))
      .filter((cause) => cause.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filteredNotes]);

  function clearFilters() {
    setWork("");
    setPeriod(defaultPeriod);
    setDateFrom("");
    setDateTo("");
    setQuery("");
  }

  return (
    <PortalShell active="dashboard" role={role} userEmail={userEmail}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Dashboard</h1>
            <p>Acompanhe as notas recebidas e os principais desvios.</p>
          </div>
        </header>

        <form className={styles.filters} onSubmit={(event) => event.preventDefault()}>
          <label className={styles.filterField}>
            <span>Obra</span>
            <span className={styles.control}>
              <Icon name="search" />
              <select value={work} onChange={(event) => setWork(event.target.value)}>
                <option value="">Todas as obras</option>
                {workOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </label>

          <label className={styles.filterField}>
            <span>Período</span>
            <span className={styles.control}>
              <Icon name="calendar" />
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                {periodOptions.map((value) => (
                  <option key={value} value={value}>
                    {periodLabel(value)}
                  </option>
                ))}
                <option value="todos">Todos os meses</option>
              </select>
              <Icon name="chevron" />
            </span>
          </label>

          <label className={`${styles.filterField} ${styles.noteSearch}`}>
            <span>Número da nota</span>
            <span className={styles.control}>
              <Icon name="search" />
              <input
                aria-label="Buscar por número da nota"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por número da nota"
                value={query}
              />
            </span>
          </label>

          <label className={`${styles.filterField} ${styles.dateFilterField}`}>
            <span>Datas</span>
            <span className={styles.dateRangeGroup} aria-label="Intervalo de datas">
              <span className={styles.dateControl}>
                <Icon name="calendar" />
                <input
                  aria-label="Data inicial"
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPeriod("todos");
                  }}
                  type="date"
                  value={dateFrom}
                />
              </span>
              <span aria-hidden="true" className={styles.rangeSeparator}>
                até
              </span>
              <span className={styles.dateControl}>
                <Icon name="calendar" />
                <input
                  aria-label="Data final"
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPeriod("todos");
                  }}
                  type="date"
                  value={dateTo}
                />
              </span>
            </span>
          </label>

          {(work || query || period !== defaultPeriod || dateFrom || dateTo) && (
            <button className={styles.clearButton} onClick={clearFilters} type="button">
              Limpar
            </button>
          )}
        </form>

        <section className={styles.metrics} aria-label="Resumo das notas">
          <Metric icon="document" label="Notas recebidas" value={String(metrics.received)} delta={metrics.deltas.received} />
          <Metric icon="warning" label="Suspeitas" value={String(metrics.suspicious)} delta={metrics.deltas.suspicious} tone="orange" />
          <Metric icon="clock" label="Em análise" value={String(metrics.processing)} delta={metrics.deltas.processing} tone="blue" />
          <Metric icon="money" label="Valor total" value={formatMoney(metrics.total)} delta={metrics.deltas.total} tone="green" />
        </section>

        <section className={styles.contentGrid}>
          <article className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2>Principais causas de desvio</h2>
            </header>
            <div className={styles.causesTable}>
              <div className={styles.tableHeader}>
                <span>Causa</span>
                <span>Ocorrências</span>
                <span>Participação</span>
              </div>
              {causes.length ? (
                causes.map((cause) => (
                  <div className={styles.causeRow} key={cause.label}>
                    <span>{cause.label}</span>
                    <strong>{cause.count}</strong>
                    <span className={styles.progressCell}>
                      <span className={styles.progressTrack}>
                        <span style={{ width: `${Math.max(8, cause.percentage)}%` }} />
                      </span>
                      <small>{cause.percentage},0%</small>
                    </span>
                  </div>
                ))
              ) : (
                <div className={styles.emptyState}>Nenhum desvio encontrado neste filtro.</div>
              )}
            </div>
            <Link className={styles.panelLink} href="/revisao/notas">
              Ver todas as causas <Icon name="chevron" />
            </Link>
          </article>

          <article className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2>Últimos anexos</h2>
            </header>
            <div className={styles.latestList}>
              {filteredNotes.slice(0, 3).map((note) => (
                <Link
                  className={styles.latestRow}
                  href={`/revisao/notas?busca=${encodeURIComponent(note.number)}`}
                  key={note.id}
                >
                  <span className={`${styles.latestIcon} ${statusClass(note.classification)}`}>
                    <Icon name="document" />
                  </span>
                  <span className={styles.latestCopy}>
                    <strong>
                      NF {note.number} <em>•</em> {note.supplier}
                    </strong>
                    <small>
                      {note.date} <em>•</em> {note.value}
                    </small>
                  </span>
                  <span className={`${styles.statusBadge} ${statusClass(note.classification)}`}>
                    {note.classification}
                  </span>
                </Link>
              ))}
              {!filteredNotes.length ? (
                <div className={styles.emptyState}>Nenhum anexo encontrado.</div>
              ) : null}
            </div>
            <Link className={styles.panelLink} href="/revisao/notas">
              Ver todos os anexos <Icon name="chevron" />
            </Link>
          </article>
        </section>
      </div>
    </PortalShell>
  );
}

function Metric({
  delta,
  icon,
  label,
  tone,
  value,
}: {
  delta: { arrow: string; label: string; tone: "negative" | "positive" };
  icon: "clock" | "document" | "money" | "warning";
  label: string;
  tone?: "blue" | "green" | "orange";
  value: string;
}) {
  const metricTone =
    tone === "orange"
      ? styles.metricOrange
      : tone === "green"
        ? styles.metricGreen
        : styles.metricBlue;

  return (
    <article className={styles.metric}>
      <span className={`${styles.metricIcon} ${metricTone}`}>
        <Icon name={icon} />
      </span>
      <div>
        <span className={styles.metricLabel}>{label}</span>
        <strong className={styles.metricValue}>{value}</strong>
        <small className={`${styles.metricDelta} ${styles[delta.tone]}`}>
          {delta.arrow} {delta.label} <span>vs. período anterior</span>
        </small>
      </div>
    </article>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { noteRows } from "./mock-data";
import { Icon } from "./ui-icons";
import { PortalShell, type PortalRole } from "./portal-shell";
import styles from "./reviewer-dashboard-view.module.css";

type ReviewerDashboardViewProps = {
  role: PortalRole;
  userEmail?: string;
  works?: { id: string; name: string }[];
};

type DashboardNote = {
  classification: "OK" | "Suspeita" | "Em análise";
  date: string;
  id: string;
  number: string;
  reason: string;
  supplier: string;
  value: string;
  work: string;
};

const reasonLabels = [
  "Diferença de preço",
  "Data divergente",
  "Documento incompleto",
  "Quantidade acima do previsto",
  "Item não previsto no contrato",
];

const reasonByRow = [
  "Diferença de preço",
  "Data divergente",
  "Documento incompleto",
  "Quantidade acima do previsto",
  "Item não previsto no contrato",
  "Diferença de preço",
  "Documento incompleto",
  "Quantidade acima do previsto",
];

const demoNotes: DashboardNote[] = noteRows.map((row, index) => ({
  classification: index === 1 || index === 4 || index === 6 ? "Suspeita" : index === 7 ? "Em análise" : "OK",
  date: row[2],
  id: row[5],
  number: row[0],
  reason: reasonByRow[index] ?? reasonLabels[0],
  supplier: row[1],
  value: row[3],
  work: row[6],
}));

const deltaByMetric = {
  received: { label: "12,8%", tone: "positive" as const, arrow: "↑" },
  suspicious: { label: "7,7%", tone: "negative" as const, arrow: "↓" },
  processing: { label: "33,3%", tone: "positive" as const, arrow: "↑" },
  value: { label: "4,2%", tone: "negative" as const, arrow: "↓" },
};

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

function statusClass(classification: DashboardNote["classification"]) {
  if (classification === "Suspeita") return styles.statusSuspicious;
  if (classification === "Em análise") return styles.statusProcessing;
  return styles.statusOk;
}

export function ReviewerDashboardView({
  role,
  userEmail,
  works = [],
}: ReviewerDashboardViewProps) {
  const [work, setWork] = useState("");
  const [period, setPeriod] = useState("maio");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState("");

  const workOptions = useMemo(
    () =>
      [...new Set([...works.map((item) => item.name), ...demoNotes.map((item) => item.work)])].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [works],
  );

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return demoNotes.filter((note) => {
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
        (period === "maio" && note.date.includes("/05/")) ||
        (period === "abril" && note.date.includes("/04/")) ||
        (period === "marco" && note.date.includes("/03/"));
      const matchesDateRange =
        (!dateFrom || (noteDate && noteDate >= dateFrom)) &&
        (!dateTo || (noteDate && noteDate <= dateTo));
      return matchesWork && matchesQuery && matchesPeriod && matchesDateRange;
    });
  }, [dateFrom, dateTo, period, query, work]);

  const metrics = useMemo(() => {
    const received = filteredNotes.length;
    const suspicious = filteredNotes.filter(
      (note) => note.classification === "Suspeita",
    ).length;
    const processing = filteredNotes.filter(
      (note) => note.classification === "Em análise",
    ).length;
    const total = filteredNotes.reduce((sum, note) => sum + parseMoney(note.value), 0);
    return { processing, received, suspicious, total };
  }, [filteredNotes]);

  const causes = useMemo(() => {
    const counts = new Map<string, number>();
    filteredNotes.forEach((note) => {
      counts.set(note.reason, (counts.get(note.reason) ?? 0) + 1);
    });
    const total = Math.max(1, filteredNotes.length);
    return reasonLabels
      .map((label) => ({
        count: counts.get(label) ?? 0,
        label,
        percentage: Math.round(((counts.get(label) ?? 0) / total) * 100),
      }))
      .filter((cause) => cause.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filteredNotes]);

  function clearFilters() {
    setWork("");
    setPeriod("maio");
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
                <option value="maio">01/05/2024 – 31/05/2024</option>
                <option value="abril">01/04/2024 – 30/04/2024</option>
                <option value="marco">01/03/2024 – 31/03/2024</option>
                <option value="todos">Todos os períodos</option>
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

          <label className={styles.filterField}>
            <span>Datas</span>
            <span className={`${styles.control} ${styles.dateRangeControl}`}>
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
              <span aria-hidden="true">até</span>
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
          </label>

          {(work || query || period !== "maio" || dateFrom || dateTo) && (
            <button className={styles.clearButton} onClick={clearFilters} type="button">
              Limpar
            </button>
          )}
        </form>

        <section className={styles.metrics} aria-label="Resumo das notas">
          <Metric icon="document" label="Notas recebidas" value={String(metrics.received)} delta={deltaByMetric.received} />
          <Metric icon="warning" label="Suspeitas" value={String(metrics.suspicious)} delta={deltaByMetric.suspicious} tone="orange" />
          <Metric icon="clock" label="Em análise" value={String(metrics.processing)} delta={deltaByMetric.processing} tone="blue" />
          <Metric icon="money" label="Valor total" value={formatMoney(metrics.total)} delta={deltaByMetric.value} tone="green" />
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

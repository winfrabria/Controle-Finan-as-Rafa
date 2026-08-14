"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import { PortalShell, type PortalRole } from "./portal-shell";
import type { ReviewerDashboardNote } from "./reviewer-dashboard-types";
import {
  formatDashboardMoney,
  parseDashboardMoney,
} from "./dashboard-money";
import styles from "./reviewer-dashboard-view.module.css";

type ReviewerDashboardViewProps = {
  role: PortalRole;
  userEmail?: string;
  works?: { id: string; name: string }[];
  notes?: ReviewerDashboardNote[];
};

type DashboardNote = ReviewerDashboardNote;

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

function currentPeriodValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function statusClass(classification: DashboardNote["classification"]) {
  if (classification === "Suspeita") return styles.statusSuspicious;
  if (classification === "Precisa de informação" || classification === "Sem parâmetro") {
    return styles.statusNeedsContext;
  }
  if (
    classification === "Aguardando processamento" ||
    classification === "Em análise" ||
    classification === "Não processado"
  ) {
    return styles.statusProcessing;
  }
  if (classification === "Falha de leitura" || classification === "Falha de processamento") {
    return styles.statusFailed;
  }
  return styles.statusOk;
}

function statusIcon(classification: DashboardNote["classification"]): "document" | "help" {
  return classification === "Precisa de informação" || classification === "Sem parâmetro"
    ? "help"
    : "document";
}

function statusLabel(classification: DashboardNote["classification"]) {
  return classification === "Sem parâmetro" ? "Precisa de informação" : classification;
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
  const notesPath = role === "admin" ? "/admin/notas" : "/revisao/notas";
  const [work, setWork] = useState("");
  const [responsible, setResponsible] = useState("");
  const currentPeriod = useMemo(() => currentPeriodValue(), []);
  const periodOptions = useMemo(
    () =>
      [...new Set([currentPeriod, ...notes.map((note) => note.dateKey)])]
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a)),
    [currentPeriod, notes],
  );
  const defaultPeriod = currentPeriod;
  const [period, setPeriod] = useState(defaultPeriod);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState("");
  const [showAllCauses, setShowAllCauses] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const workOptions = useMemo(
    () => {
      const options = new Map(works.map((item) => [item.id, item.name]));
      notes.forEach((item) => options.set(item.workId, item.work));
      return [...options.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
    [notes, works],
  );
  const responsibleOptions = useMemo(
    () =>
      [...new Set(notes.map((item) => item.responsible).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [notes],
  );

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return notes.filter((note) => {
      const matchesWork = !work || note.workId === work;
      const matchesResponsible = !responsible || note.responsible === responsible;
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
      return (
        matchesWork &&
        matchesResponsible &&
        matchesQuery &&
        matchesPeriod &&
        matchesDateRange
      );
    });
  }, [dateFrom, dateTo, notes, period, query, responsible, work]);

  const comparisonNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return notes.filter((note) => {
      const matchesWork = !work || note.workId === work;
      const matchesResponsible = !responsible || note.responsible === responsible;
      const matchesQuery =
        !normalizedQuery ||
        note.number.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        note.supplier.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      return matchesWork && matchesResponsible && matchesQuery;
    });
  }, [notes, query, responsible, work]);

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
        note.classification === "Aguardando processamento" ||
        note.classification === "Em análise" ||
        note.classification === "Falha de processamento",
    ).length;
    const total = filteredNotes.reduce(
      (sum, note) => sum + parseDashboardMoney(note.value),
      0,
    );
    const previousReceived = periodComparisonNotes.length;
    const previousSuspicious = periodComparisonNotes.filter(
      (note) => note.classification === "Suspeita",
    ).length;
    const previousProcessing = periodComparisonNotes.filter(
      (note) =>
        note.classification === "Aguardando processamento" ||
        note.classification === "Em análise" ||
        note.classification === "Falha de processamento",
    ).length;
    const previousTotal = periodComparisonNotes.reduce(
      (sum, note) => sum + parseDashboardMoney(note.value),
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
    setResponsible("");
    setPeriod(defaultPeriod);
    setDateFrom("");
    setDateTo("");
    setQuery("");
  }

  return (
    <PortalShell active="dashboard" role={role} userEmail={userEmail}>
      <div className={`${styles.page} ${role === "reviewer" ? styles.reviewerPage : ""}`}>
        {role === "reviewer" ? (
          <section className={styles.mobileDashboard} aria-label="Dashboard mobile">
            <header className={styles.mobileHeading}>
              <h1>Bom dia, Rafael</h1>
              <p>Resumo dos anexos</p>
            </header>

            <div className={styles.mobileToolbar}>
              <label className={styles.mobilePeriod}>
                <Icon name="calendar" />
                <span className={styles.mobileSrOnly}>Período</span>
                <select
                  aria-label="Período"
                  onChange={(event) => {
                    setPeriod(event.target.value);
                    setDateFrom("");
                    setDateTo("");
                  }}
                  value={period}
                >
                  {periodOptions.map((value) => (
                    <option key={value} value={value}>{periodLabel(value)}</option>
                  ))}
                  <option value="todos">Todos os meses</option>
                </select>
                <Icon name="chevron" />
              </label>
              <button
                aria-expanded={mobileFiltersOpen}
                className={styles.mobileFilterButton}
                onClick={() => setMobileFiltersOpen((current) => !current)}
                type="button"
              >
                <Icon name="filter" /> Filtrar
              </button>
            </div>

            {mobileFiltersOpen ? (
              <div className={styles.mobileFilterSheet}>
                <label>
                  <span>Obra</span>
                  <select onChange={(event) => setWork(event.target.value)} value={work}>
                    <option value="">Todas as obras</option>
                    {workOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Responsável</span>
                  <select onChange={(event) => setResponsible(event.target.value)} value={responsible}>
                    <option value="">Todos os responsáveis</option>
                    {responsibleOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  <span>Número ou fornecedor</span>
                  <input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar anexo" value={query} />
                </label>
                <div className={styles.mobileDateRange}>
                  <label>
                    <span>De</span>
                    <input onChange={(event) => { setDateFrom(event.target.value); setPeriod("todos"); }} type="date" value={dateFrom} />
                  </label>
                  <label>
                    <span>Até</span>
                    <input onChange={(event) => { setDateTo(event.target.value); setPeriod("todos"); }} type="date" value={dateTo} />
                  </label>
                </div>
                {(work || responsible || query || period !== defaultPeriod || dateFrom || dateTo) ? (
                  <button className={styles.mobileClear} onClick={clearFilters} type="button">Limpar filtros</button>
                ) : null}
              </div>
            ) : null}

            <article className={styles.mobileSummaryCard}>
              <span>Valor total analisado</span>
              <strong>{formatDashboardMoney(metrics.total)}</strong>
              <div>
                <span><b>{metrics.received}</b> anexos</span>
                <span className={styles.mobileSuspicious}><b>{metrics.suspicious}</b> suspeitas</span>
                <span className={styles.mobileOk}><b>{filteredNotes.filter((note) => note.classification === "OK").length}</b> OK</span>
              </div>
            </article>

            <section className={styles.mobileSection}>
              <header><h2>Principais desvios</h2><Link href={notesPath}>Ver todos</Link></header>
              <div className={styles.mobileCauses}>
                {causes.slice(0, 3).map((cause) => (
                  <Link href={notesPath} key={cause.label}>
                    <span className={styles.mobileCauseIcon}><Icon name="warning" /></span>
                    <span><strong>{cause.label}</strong><small>{cause.count} ocorrência{cause.count === 1 ? "" : "s"}</small></span>
                    <span className={styles.mobileCausePercent}>{cause.percentage}%</span>
                    <Icon name="chevron" />
                  </Link>
                ))}
                {!causes.length ? <p className={styles.mobileEmpty}>Nenhum desvio neste período.</p> : null}
              </div>
            </section>

            <section className={styles.mobileSection}>
              <header><h2>Últimos anexos</h2><Link href={notesPath}>Ver todos</Link></header>
              <div className={styles.mobileLatest}>
                {filteredNotes.slice(0, 3).map((note) => (
                  <Link href={`/notas/${note.id}/analise-ia`} key={note.id}>
                    <span className={`${styles.mobileLatestIcon} ${statusClass(note.classification)}`}><Icon name={statusIcon(note.classification)} /></span>
                    <span><strong>{note.number}</strong><small>{note.supplier} · {note.date}</small></span>
                    <em className={statusClass(note.classification)}>{statusLabel(note.classification)}</em>
                    <Icon name="chevron" />
                  </Link>
                ))}
                {!filteredNotes.length ? <p className={styles.mobileEmpty}>Nenhum anexo neste período.</p> : null}
              </div>
            </section>
          </section>
        ) : null}
        <header className={styles.pageHeader}>
          <div>
            <h1>Dashboard</h1>
            <p>Acompanhe os anexos recebidos e os principais desvios.</p>
          </div>
        </header>

        <form className={styles.filters} onSubmit={(event) => event.preventDefault()}>
          <label className={styles.filterField}>
            <span>Obra</span>
            <span className={styles.control}>
              <Icon name="search" />
              <select
                aria-label="Obra"
                value={work}
                onChange={(event) => setWork(event.target.value)}
              >
                <option value="">Todas as obras</option>
                {workOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
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
              <select
                aria-label="Período"
                value={period}
                onChange={(event) => {
                  setPeriod(event.target.value);
                  setDateFrom("");
                  setDateTo("");
                }}
              >
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

          <label className={styles.filterField}>
            <span>Responsável</span>
            <span className={styles.control}>
              <Icon name="building" />
              <select
                aria-label="Responsável"
                value={responsible}
                onChange={(event) => setResponsible(event.target.value)}
              >
                <option value="">Todos os responsáveis</option>
                {responsibleOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
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

          {(work || responsible || query || period !== defaultPeriod || dateFrom || dateTo) && (
            <button className={styles.clearButton} onClick={clearFilters} type="button">
              Limpar
            </button>
          )}
        </form>

        <section className={styles.metrics} aria-label="Resumo dos anexos">
          <Metric icon="document" label="Anexos recebidos" value={String(metrics.received)} delta={metrics.deltas.received} />
          <Metric icon="warning" label="Suspeitas" value={String(metrics.suspicious)} delta={metrics.deltas.suspicious} tone="orange" />
          <Metric icon="clock" label="Em processamento" value={String(metrics.processing)} delta={metrics.deltas.processing} tone="blue" />
          <Metric icon="money" label="Valor total" value={formatDashboardMoney(metrics.total)} delta={metrics.deltas.total} tone="green" />
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
                (showAllCauses ? causes : causes.slice(0, 4)).map((cause) => (
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
            {causes.length > 4 ? (
              <button
                className={styles.panelLink}
                onClick={() => setShowAllCauses((current) => !current)}
                type="button"
              >
                {showAllCauses ? "Recolher" : `Ver todas (${causes.length})`}
                <Icon name="chevron" />
              </button>
            ) : (
              <Link className={styles.panelLink} href={notesPath}>
                Ver anexos relacionados <Icon name="chevron" />
              </Link>
            )}
          </article>

          <article className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2>Últimos anexos</h2>
            </header>
            <div className={styles.latestList}>
              {filteredNotes.slice(0, 3).map((note) => (
                <Link
                  className={styles.latestRow}
                  href={`${notesPath}?busca=${encodeURIComponent(note.number)}`}
                  key={note.id}
                >
                  <span className={`${styles.latestIcon} ${statusClass(note.classification)}`}>
                    <Icon name={statusIcon(note.classification)} />
                  </span>
                  <span className={styles.latestCopy}>
                    <strong>
                      Anexo {note.number} <em>•</em> {note.supplier}
                    </strong>
                    <small>
                      {note.date} <em>•</em>{" "}
                      {formatDashboardMoney(parseDashboardMoney(note.value))}
                    </small>
                  </span>
                  <span className={`${styles.statusBadge} ${statusClass(note.classification)}`}>
                    {statusLabel(note.classification)}
                  </span>
                </Link>
              ))}
              {!filteredNotes.length ? (
                <div className={styles.emptyState}>Nenhum anexo encontrado.</div>
              ) : null}
            </div>
            <Link className={styles.panelLink} href={notesPath}>
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

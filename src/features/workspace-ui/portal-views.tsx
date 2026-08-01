"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminWorksClient } from "./admin-works-client";
import { DashboardFilters } from "./dashboard-filters";
import { LogsExplorer, type AuditLog } from "./logs-explorer";
import { noteRows, validationRows } from "./mock-data";
import { Icon } from "./ui-icons";
import {
  MetricCard,
  PageIntro,
  PortalShell,
  StatusBadge,
  type PortalRole,
} from "./portal-shell";
import styles from "./workspace-ui.module.css";
import noteStyles from "./notes-view.module.css";
import { ValidationDecisionForm } from "./validation-decision-form";
import { ReviewerNotesView } from "./reviewer-notes-view";
import type { NoteVisualItem } from "./note-types";

function NotesFilterBar({
  period,
  onClear,
  onPeriodChange,
  onStatusChange,
  onWorkChange,
  status,
  work,
  works,
  periods,
}: {
  period: string;
  onClear: () => void;
  onPeriodChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onWorkChange: (value: string) => void;
  status: string;
  work: string;
  works: string[];
  periods: { val: string; label: string }[];
}) {
  return (
    <form className={noteStyles.filters} onReset={onClear}>
      <label>
        <span>Obra</span>
        <div className={noteStyles.selectWrapper}>
          <Icon name="building" />
          <select
            value={work}
            onChange={(event) => onWorkChange(event.target.value)}
          >
            <option value="">Todas as obras</option>
            {works.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
      </label>
      <label>
        <span>Período</span>
        <div className={noteStyles.selectWrapper}>
          <Icon name="calendar" />
          <select
            value={period}
            onChange={(event) => onPeriodChange(event.target.value)}
          >
            <option value="">Todos os períodos</option>
            {periods.map((p) => (
              <option key={p.val} value={p.val}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </label>
      <label>
        <span>Status</span>
        <div className={noteStyles.selectWrapper}>
          <Icon name="document" />
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="OK">OK</option>
            <option value="Suspeita">Suspeita</option>
            <option value="Em análise">Em análise</option>
          </select>
        </div>
      </label>
      <button type="reset">
        <Icon name="filter" /> Limpar filtros
      </button>
    </form>
  );
}

export function DashboardView({
  role,
  userEmail,
  works = [],
}: {
  role: PortalRole;
  userEmail?: string;
  works?: { id: string; name: string }[];
}) {
  const admin = role === "admin";
  return (
    <PortalShell active="dashboard" role={role} userEmail={userEmail}>
      <PageIntro
        title={admin ? "Dashboard Administrativo" : "Dashboard"}
        description={
          admin
            ? "Visão geral completa da plataforma com controle total de notas fiscais e validações."
            : "Visão geral da auditoria e do status das notas fiscais."
        }
      />
      <section
        className={`${styles.metrics} ${admin ? styles.metricsAdmin : ""}`}
      >
        <MetricCard
          icon="document"
          label="Total de notas"
          value={admin ? "2.847" : "1.248"}
          footnote="↗ 12,8% vs. período anterior"
        />
        <MetricCard
          icon="warning"
          label="Notas suspeitas"
          value={admin ? "176" : "142"}
          footnote={admin ? "↗ 6,2% vs. período anterior" : "11,4% do total"}
          tone="orange"
        />
        {admin && (
          <MetricCard
            icon="building"
            label="Obras cadastradas"
            value="48"
            footnote="↗ 3 novas vs. período anterior"
          />
        )}
        <MetricCard
          icon={admin ? "shield" : "money"}
          label={admin ? "Validações pelo Rafael" : "Valor analisado"}
          value={admin ? "498" : "R$ 8,45 mi"}
          footnote="↗ 18,4% vs. período anterior"
          tone={admin ? "blue" : "green"}
        />
        <MetricCard
          icon={admin ? "money" : "shield"}
          label={admin ? "Valor analisado" : "Pendentes de validação"}
          value={admin ? "R$ 18,75 mi" : "198"}
          footnote={admin ? "↗ 15,6% vs. período anterior" : "15,9% do total"}
          tone={admin ? "green" : "blue"}
        />
      </section>
      <DashboardFilters role={role} works={works} />
      {admin ? <AdminDashboardPanels /> : <ReviewerDashboardPanels />}
    </PortalShell>
  );
}

function ReviewerDashboardPanels() {
  return (
    <section className={styles.dashboardGrid}>
      {/* Status das notas */}
      <article className={`${styles.panel} ${styles.chartPanel}`}>
        <div className={styles.panelHeader}>
          <h2>Status das notas</h2>
        </div>
        <div className={styles.donutWrap}>
          <div className={styles.donut}>
            <span>
              <strong>1.248</strong>
              <small>Total</small>
            </span>
          </div>
          <div className={styles.legend}>
            <p>
              <i className={styles.greenDot} /> OK <b>1.106 (88,7%)</b>
            </p>
            <p>
              <i className={styles.orangeDot} /> Suspeita <b>142 (11,3%)</b>
            </p>
            <Link href="/revisao/notas">Ver todas as notas →</Link>
          </div>
        </div>
      </article>

      {/* Notas suspeitas recentes */}
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Notas suspeitas recentes</h2>
          <Link href="/revisao/notas">Ver todas</Link>
        </div>
        <ul className={styles.compactList}>
          {noteRows.slice(0, 5).map((n) => (
            <li key={n[5]}>
              <span>{n[0]}</span>
              <b>{n[1]}</b>
              <span>{n[2]}</span>
              <strong style={{ color: "#ff9000" }}>{n[3]}</strong>
              <Icon name="more" />
            </li>
          ))}
        </ul>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Validações pendentes</h2>
        </div>
        <div className={styles.pendingLinks}>
          <Link href="/revisao/notas" className={styles.pendingBox}>
            <span className={styles.pendingLabel}>
              <span className={styles.pendingIconGreen}>
                <Icon name="check" />
              </span>
              Notas aguardando validação
            </span>
            <span className={styles.pendingRight}>
              <strong className={styles.blueNumber}>198</strong>
              <Icon name="chevron" />
            </span>
          </Link>
          <Link href="/revisao/notas" className={styles.pendingBox}>
            <span className={styles.pendingLabel}>
              <span className={styles.pendingIconOrange}>
                <Icon name="warning" />
              </span>
              Suspeitas aguardando análise
            </span>
            <span className={styles.pendingRight}>
              <strong className={styles.orangeNumber}>142</strong>
              <Icon name="chevron" />
            </span>
          </Link>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          <Link className={styles.primaryActionBlue} href="/revisao/notas">
            <Icon name="document" /> Ir para Notas
          </Link>
        </div>
      </article>
    </section>
  );
}

function AdminDashboardPanels() {
  const obras = [
    {
      name: "Projeto Piloto",
      notes: 624,
      value: "R$ 4,87 mi",
      lastNote: "28/05/2024",
    },
    {
      name: "Edifício Aurora",
      notes: 512,
      value: "R$ 3,21 mi",
      lastNote: "27/05/2024",
    },
    {
      name: "Hospital Central",
      notes: 438,
      value: "R$ 2,98 mi",
      lastNote: "27/05/2024",
    },
    {
      name: "Viaduto Norte",
      notes: 376,
      value: "R$ 2,45 mi",
      lastNote: "26/05/2024",
    },
    {
      name: "Complexo Industrial",
      notes: 322,
      value: "R$ 2,10 mi",
      lastNote: "26/05/2024",
    },
  ];
  const logs = [
    {
      action: "Nota validada",
      user: "Rafael",
      details: "Construtora Silva Ltda. - R$ 249.200,00",
      date: "26/05/2024 10:32",
    },
    {
      action: "Nota classificada como suspeita",
      user: "Rafael",
      details: "Transportes Ideal - R$ 18.900,00",
      date: "27/05/2024 16:11",
    },
    {
      action: "Nova nota enviada",
      user: "Rafael",
      details: "Elétrica Forte Ltda. - R$ 6.750,00",
      date: "27/05/2024 16:42",
    },
    {
      action: "Nota validada",
      user: "Rafael",
      details: "Locação Equip. Sul - R$ 12.500,00",
      date: "26/05/2024 11:08",
    },
    {
      action: "Login realizado",
      user: "Rafael",
      details: "Acesso à plataforma",
      date: "26/05/2024 08:22",
    },
  ];
  return (
    <section className={styles.adminPanels}>
      {/* Últimas validações do Rafael */}
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Últimas validações do Rafael</h2>
          <Link href="/admin/validacoes">Ver todas</Link>
        </div>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th>Obra</th>
              <th>Valor</th>
              <th>Classificação</th>
              <th>Emissão</th>
            </tr>
          </thead>
          <tbody>
            {noteRows.slice(0, 5).map((n, i) => (
              <tr key={n[5]}>
                <td style={{ fontSize: "11px" }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        background: i % 2 === 0 ? "#e4f8ed" : "#fff1df",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={i % 2 === 0 ? "check" : "warning"} />
                    </span>
                    {n[1]}
                  </span>
                </td>
                <td style={{ fontSize: "11px" }}>
                  {n[6]?.toString().split(" ").slice(0, 2).join(" ")}
                </td>
                <td style={{ fontSize: "11px" }}>{n[3]}</td>
                <td>
                  <StatusBadge tone={n[4] === "OK" ? "ok" : "warning"}>
                    {n[4] === "OK" ? "«OK»" : "Suspeita"}
                  </StatusBadge>
                </td>
                <td style={{ fontSize: "11px" }}>{n[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "center", padding: "10px" }}>
          <Link
            href="/admin/validacoes"
            style={{
              color: "var(--blue)",
              fontSize: "12px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Ver todas as validações →
          </Link>
        </div>
      </article>

      {/* Obras recentes */}
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Obras recentes</h2>
          <Link href="/admin/obras">Ver todas</Link>
        </div>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Obra</th>
              <th>Notas</th>
              <th>Valor analisado</th>
              <th>Última nota</th>
            </tr>
          </thead>
          <tbody>
            {obras.map((w) => (
              <tr key={w.name}>
                <td style={{ fontSize: "11px" }}>{w.name}</td>
                <td style={{ fontSize: "11px" }}>{w.notes}</td>
                <td style={{ fontSize: "11px" }}>{w.value}</td>
                <td style={{ fontSize: "11px" }}>{w.lastNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "center", padding: "10px" }}>
          <Link
            href="/admin/obras"
            style={{
              color: "var(--blue)",
              fontSize: "12px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Ver todas as obras →
          </Link>
        </div>
      </article>

      {/* Atividade recente / logs */}
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Atividade recente / logs resumidos</h2>
          <Link href="/admin/logs">Ver todos</Link>
        </div>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Ação</th>
              <th>Usuário</th>
              <th>Detalhes</th>
              <th>Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={i}>
                <td style={{ fontSize: "11px" }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Icon name="shield" />
                    {l.action}
                  </span>
                </td>
                <td style={{ fontSize: "11px" }}>{l.user}</td>
                <td style={{ fontSize: "11px" }}>{l.details}</td>
                <td style={{ fontSize: "11px", whiteSpace: "nowrap" }}>
                  {l.date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "center", padding: "10px" }}>
          <Link
            href="/admin/logs"
            style={{
              color: "var(--blue)",
              fontSize: "12px",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Ver todos os logs →
          </Link>
        </div>
      </article>
    </section>
  );
}

export function NotesView({
  role,
  items,
}: {
  role: PortalRole;
  items?: NoteVisualItem[];
}) {
  const rows: NoteVisualItem[] =
    items !== undefined
      ? items
      : noteRows.map((n) => ({
          id: n[5],
          number: n[0],
          supplier: n[1],
          date: n[2],
          value: n[3],
          classification: n[4],
          version: 1,
          work: n[6],
        }));

  const [work, setWork] = useState("");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleWorkChange = (val: string) => {
    setWork(val);
    setPage(1);
  };
  const handleStatusChange = (val: string) => {
    setStatus(val);
    setPage(1);
  };
  const handlePeriodChange = (val: string) => {
    setPeriod(val);
    setPage(1);
  };

  const works = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => row.work)
            .filter((item): item is string => Boolean(item)),
        ),
      ).sort(),
    [rows],
  );
  const periods = useMemo(() => {
    const p = new Map<string, string>();
    rows.forEach((r) => {
      const parts = r.date.split("/"); // DD/MM/YYYY
      if (parts.length === 3) {
        const key = `${parts[1]}/${parts[2]}`;
        const date = new Date(Number(parts[2]), Number(parts[1]) - 1, 1);
        const label = new Intl.DateTimeFormat("pt-BR", {
          month: "long",
          year: "numeric",
        }).format(date);
        p.set(key, label.charAt(0).toUpperCase() + label.slice(1));
      }
    });
    return Array.from(p.entries())
      .map(([val, label]) => ({ val, label }))
      .sort((a, b) => a.val.localeCompare(b.val));
  }, [rows]);
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        let periodMatch = true;
        if (period) {
          const parts = row.date.split("/");
          if (parts.length === 3) {
            periodMatch = period === `${parts[1]}/${parts[2]}`;
          }
        }
        return (
          (!work || row.work === work) &&
          (!status || row.classification === status) &&
          periodMatch
        );
      }),
    [period, rows, status, work],
  );
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const clearFilters = () => {
    setWork("");
    setStatus("");
    setPeriod("");
    setPage(1);
  };
  if (role === "reviewer") {
    return <ReviewerNotesView items={rows} role={role} />;
  }
  return (
    <PortalShell active="notas" role={role}>
      <PageIntro
        title="Notas"
        description={
          role === "admin"
            ? "Gerencie as notas fiscais cadastradas no sistema."
            : "Consulte e acompanhe todas as notas fiscais enviadas para análise."
        }
      />
      <section className={`${styles.notesMetrics} ${noteStyles.metrics}`}>
        <MetricCard
          icon="document"
          label="Total de notas"
          value={role === "admin" ? "2.847" : "1.248"}
          footnote="+12,5% vs. período anterior ↗"
        />
        <MetricCard
          icon="warning"
          label="Notas suspeitas"
          value={role === "admin" ? "176" : "142"}
          footnote="11,4% do total"
          tone="orange"
        />
        <MetricCard
          icon="money"
          label={role === "admin" ? "Notas OK" : "Valor total analisado"}
          value={role === "admin" ? "2.671" : "R$ 8,45 mi"}
          footnote="+18,7% vs. período anterior ↗"
          tone="green"
        />
      </section>
      <NotesFilterBar
        period={period}
        onClear={clearFilters}
        onPeriodChange={handlePeriodChange}
        onStatusChange={handleStatusChange}
        onWorkChange={handleWorkChange}
        status={status}
        work={work}
        works={works}
        periods={periods}
      />
      <section className={`${styles.panel} ${noteStyles.notesPanel}`}>
        <table className={`${styles.dataTable} ${noteStyles.table}`}>
          <thead>
            <tr>
              <th>Nº da nota</th>
              <th>Fornecedor</th>
              <th>Data</th>
              <th>Classificação</th>
              <th>Valor</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((n) => (
              <tr key={n.id}>
                <td>{n.number}</td>
                <td>{n.supplier}</td>
                <td>{n.date}</td>
                <td>
                  <StatusBadge
                    tone={n.classification === "OK" ? "ok" : "warning"}
                  >
                    {n.classification}
                  </StatusBadge>
                </td>
                <td>
                  <strong>{n.value}</strong>
                </td>
                <td>
                  <Link href={`/notas/${n.id}`} className={styles.eyeButton}>
                    <Icon name="eye" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`${styles.mobileCardsList} ${noteStyles.mobileList}`}>
          {paginatedRows.map((n) => (
            <article
              className={`${styles.noteMobileCard} ${noteStyles.mobileCard}`}
              key={n.id}
            >
              <span className={styles.noteIcon}>
                <Icon name="document" />
              </span>
              <div>
                <h2>{n.number}</h2>
                <p>{n.supplier}</p>
                <small>
                  <Icon name="calendar" />
                  {n.date}
                </small>
              </div>
              <aside>
                <StatusBadge
                  tone={n.classification === "OK" ? "ok" : "warning"}
                >
                  {n.classification}
                </StatusBadge>
                <strong>{n.value}</strong>
                <Link href={`/notas/${n.id}`} className={styles.eyeButton}>
                  <Icon name="eye" />
                </Link>
              </aside>
            </article>
          ))}
        </div>
        {filteredRows.length === 0 ? (
          <p className={noteStyles.empty}>
            Nenhuma nota encontrada com esses filtros.
          </p>
        ) : (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filteredRows.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </section>
    </PortalShell>
  );
}

export function ValidationView({
  role,
  items,
}: {
  role: PortalRole;
  items?: NoteVisualItem[];
}) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showFilters, setShowFilters] = useState(false);
  const [workFilter, setWorkFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const queue = useMemo(() => {
    let list =
      items && items.length > 0
        ? items
        : validationRows.map((item) => ({ ...item }));
    if (role !== "admin") {
      list = list.filter((n) => n.classification === "Suspeita");
    }
    return list.map((item) => ({
      ...item,
      state: item.classification === "OK" ? "ok" : "warning",
    }));
  }, [items, role]);

  const works = useMemo(() => {
    const set = new Set<string>();
    queue.forEach((item) => {
      if (item.work) set.add(item.work);
    });
    return Array.from(set).sort();
  }, [queue]);

  const filteredQueue = useMemo(() => {
    let list = queue;
    if (workFilter) {
      list = list.filter((n) => n.work === workFilter);
    }
    if (periodFilter) {
      const parts = periodFilter.split("/"); // MM/YYYY
      if (parts.length === 2) {
        list = list.filter((n) => {
          const noteParts = n.date.split("/"); // DD/MM/YYYY
          return (
            noteParts.length === 3 &&
            noteParts[1] === parts[0] &&
            noteParts[2] === parts[1]
          );
        });
      }
    }
    if (statusFilter) {
      list = list.filter((n) => n.classification === statusFilter);
    }
    return list;
  }, [queue, workFilter, periodFilter, statusFilter]);

  const selectedNote =
    filteredQueue.find((n) => n.id === selectedNoteId) || filteredQueue[0];

  const paginatedQueue = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredQueue.slice(start, start + pageSize);
  }, [filteredQueue, page, pageSize]);

  const periods = useMemo(() => {
    const p = new Map<string, string>();
    queue.forEach((r) => {
      const parts = r.date.split("/"); // DD/MM/YYYY
      if (parts.length === 3) {
        const key = `${parts[1]}/${parts[2]}`;
        const date = new Date(Number(parts[2]), Number(parts[1]) - 1, 1);
        const label = new Intl.DateTimeFormat("pt-BR", {
          month: "long",
          year: "numeric",
        }).format(date);
        p.set(key, label.charAt(0).toUpperCase() + label.slice(1));
      }
    });
    return Array.from(p.entries())
      .map(([val, label]) => ({ val, label }))
      .sort((a, b) => a.val.localeCompare(b.val));
  }, [queue]);

  return (
    <PortalShell active="validacoes" role={role}>
      <PageIntro
        title="Validações"
        description={
          role === "admin"
            ? "Acompanhe as decisões registradas pelo Rafael e consulte as evidências de cada nota."
            : "Revise e classifique as notas fiscais que aguardam sua validação."
        }
      />
      <section className={styles.validationGrid}>
        <article
          className={`${styles.panel} ${styles.validationQueue}`}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <div className={styles.panelHeader}>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {role === "admin"
                ? "Validações realizadas pelo Rafael "
                : "Notas aguardando validação "}
              <StatusBadge tone="info">{filteredQueue.length}</StatusBadge>
            </h2>
            <button
              className={styles.btnOutline}
              style={{
                minHeight: "32px",
                padding: "0 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Icon name="filter" /> Filtrar {showFilters ? "▲" : "▼"}
            </button>
          </div>

          {showFilters && (
            <div
              style={{
                display: "flex",
                gap: "16px",
                padding: "16px 20px",
                background: "#f8fafc",
                borderBottom: "1px solid var(--line)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {/* Obra Filter */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  minWidth: "150px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "#64748b",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  Obra
                </span>
                <select
                  value={workFilter}
                  onChange={(e) => {
                    setWorkFilter(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Todas as obras</option>
                  {works.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>

              {/* Período Filter */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  minWidth: "150px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "#64748b",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  Período
                </span>
                <select
                  value={periodFilter}
                  onChange={(e) => {
                    setPeriodFilter(e.target.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Todos os períodos</option>
                  {periods.map((p) => (
                    <option key={p.val} value={p.val}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Status/Classificação Filter */}
              {role === "admin" && (
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    minWidth: "150px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    Classificação
                  </span>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">Todas</option>
                    <option value="OK">OK</option>
                    <option value="Suspeita">Suspeita</option>
                    <option value="Em análise">Em análise</option>
                  </select>
                </label>
              )}

              {/* Limpar button */}
              <button
                type="button"
                onClick={() => {
                  setWorkFilter("");
                  setPeriodFilter("");
                  setStatusFilter("");
                  setPage(1);
                }}
                style={{
                  alignSelf: "flex-end",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "#334155",
                  height: "32px",
                  marginBottom: "2px",
                }}
              >
                Limpar
              </button>
            </div>
          )}

          <div style={{ flex: 1 }}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Nº da nota</th>
                  <th>Valor</th>
                  <th>Emitida em</th>
                  <th>Classificação IA</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedQueue.map((n) => (
                  <tr
                    key={n.id}
                    className={
                      n.id === selectedNote?.id
                        ? styles.selectedTableRow
                        : undefined
                    }
                    onClick={() => setSelectedNoteId(n.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            color:
                              n.classification === "OK"
                                ? "#00c875"
                                : n.state === "danger"
                                  ? "#ef2c2c"
                                  : "#ff9000",
                          }}
                        >
                          <Icon
                            name={
                              n.classification === "OK"
                                ? "check"
                                : n.state === "danger"
                                  ? "close"
                                  : "warning"
                            }
                          />
                        </span>
                        {n.supplier}
                      </span>
                    </td>
                    <td>{n.number}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{n.value}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{n.date}</td>
                    <td>
                      <StatusBadge
                        tone={n.classification === "OK" ? "ok" : "warning"}
                      >
                        {n.classification}
                      </StatusBadge>
                    </td>
                    <td style={{ color: "#94a3b8" }}>
                      <Icon name="chevron" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredQueue.length === 0 && (
              <p
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  padding: "24px",
                  fontSize: "14px",
                }}
              >
                Nenhuma nota encontrada com os filtros selecionados.
              </p>
            )}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filteredQueue.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </article>
        {selectedNote && (
          <ValidationDetail
            note={selectedNote}
            readOnly={role === "admin"}
            onCancel={() => setSelectedNoteId(null)}
          />
        )}
      </section>
    </PortalShell>
  );
}

function ValidationDetail({
  note,
  readOnly,
  onCancel,
}: {
  note: NoteVisualItem & { state: string };
  readOnly: boolean;
  onCancel: () => void;
}) {
  return (
    <article className={`${styles.panel} ${styles.validationDetail}`}>
      <div
        className={styles.panelHeader}
        style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 600 }}>
          Detalhes da nota selecionada
        </h2>
        <Link href={`/notas/${note.id}`} className={styles.btnOutlineLink}>
          Ir para nota detalhada ↗
        </Link>
      </div>

      <div style={{ padding: "24px" }}>
        <dl className={styles.noteSummaryCard}>
          <div className={styles.summaryIconBox}>
            <Icon name="document" />
          </div>
          <div className={styles.summaryDataGroup}>
            <div>
              <dt>Fornecedor</dt>
              <dd>
                <strong>{note.supplier}</strong>
              </dd>
            </div>
            <div>
              <dt>Nº da nota</dt>
              <dd>
                <strong>{note.number}</strong>
              </dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd className={styles.redValue}>
                <strong>{note.value}</strong>
              </dd>
            </div>
            <div>
              <dt>Emitida em</dt>
              <dd>
                <strong>{note.date}</strong>
              </dd>
            </div>
          </div>
        </dl>

        <section className={styles.aiBoxSection}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Classificação sugerida pela IA
            </h3>
            <StatusBadge tone="warning">Suspeita</StatusBadge>
          </div>
          <div className={styles.aiBoxContent}>
            <Icon name="sparkles" />
            <p style={{ margin: 0 }}>
              A IA identificou divergências de preço e quantidade entre esta
              nota e históricos de compras similares.
            </p>
          </div>
        </section>

        {readOnly ? (
          <section className={styles.adminValidationReview}>
            <h3>Decisão registrada pelo Rafael</h3>
            <dl>
              <div>
                <dt>Classificação</dt>
                <dd>
                  <StatusBadge tone="warning">Suspeita</StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Motivo</dt>
                <dd>Divergência de quantidade e/ou valor</dd>
              </div>
              <div>
                <dt>Registrada em</dt>
                <dd>28/05/2024 10:35</dd>
              </div>
            </dl>
            <p>
              “A quantidade executada está acima do medido em campo. Favor
              revisar as evidências.”
            </p>
          </section>
        ) : (
          <ValidationDecisionForm
            isDemo={note.id.startsWith("demo")}
            noteId={note.id}
            onCancel={onCancel}
          />
        )}
      </div>
    </article>
  );
}

export function WorksView() {
  return (
    <PortalShell active="obras" role="admin">
      <AdminWorksClient />
    </PortalShell>
  );
}

export function LogsView({ logs }: { logs: AuditLog[] }) {
  const okCount = logs.filter((log) => log.classification === "OK").length;
  const suspiciousCount = logs.filter((log) => log.classification === "Suspeita").length;
  return (
    <PortalShell active="logs" role="admin">
      <PageIntro
        title="Logs"
        description="Histórico das ações e decisões tomadas por Rafael."
      />
      <section className={`${styles.metrics} ${styles.logMetrics}`}>
        <MetricCard
          icon="document"
          label="Total de logs"
          value={String(logs.length)}
          footnote="Eventos reais carregados"
        />
        <MetricCard
          icon="check"
          label="Validações OK"
          value={String(okCount)}
          footnote="Decisões e processamentos OK"
          tone="green"
        />
        <MetricCard
          icon="warning"
          label="Validações suspeitas"
          value={String(suspiciousCount)}
          footnote="Suspeitas confirmadas ou pendentes"
          tone="orange"
        />
        <MetricCard
          icon="clock"
          label="Última atividade"
          value={logs[0]?.at.split(" ")[1] ?? "—"}
          footnote={logs[0]?.at ?? "Nenhuma atividade"}
          tone="purple"
        />
      </section>
      <LogsExplorer logs={logs} />
    </PortalShell>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <footer className={styles.pagination}>
      <span>
        {start}-{end} de {total.toLocaleString("pt-BR")}
      </span>
      {totalPages > 1 && (
        <div className={styles.paginationNumbers}>
          <span
            style={{
              cursor: page > 1 ? "pointer" : "default",
              opacity: page > 1 ? 1 : 0.5,
            }}
            onClick={() => page > 1 && onPageChange(page - 1)}
          >
            <Icon name="chevron" style={{ transform: "rotate(180deg)" }} />
          </span>
          {Array.from({ length: totalPages }).map((_, i) => (
            <span
              key={i}
              className={page === i + 1 ? styles.activePage : undefined}
              style={{ cursor: "pointer" }}
              onClick={() => onPageChange(i + 1)}
            >
              {i + 1}
            </span>
          ))}
          <span
            style={{
              cursor: page < totalPages ? "pointer" : "default",
              opacity: page < totalPages ? 1 : 0.5,
            }}
            onClick={() => page < totalPages && onPageChange(page + 1)}
          >
            <Icon name="chevron" />
          </span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span>Mostrar</span>
        <select
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(1);
          }}
          style={{
            background: "transparent",
            border: "1px solid var(--line)",
            borderRadius: "6px",
            padding: "4px 8px",
            color: "inherit",
            cursor: "pointer",
            font: "inherit",
            fontSize: "12px",
          }}
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>
    </footer>
  );
}

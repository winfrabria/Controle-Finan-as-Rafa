"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminWorksClient } from "./admin-works-client";
import { DashboardFilters } from "./dashboard-filters";
import { LogsExplorer } from "./logs-explorer";
import { logRows, noteRows, validationRows, workRows } from "./mock-data";
import { ReportExportButton } from "./report-export-button";
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

type NoteVisualItem = {
  id: string;
  number: string;
  supplier: string;
  date: string;
  value: string;
  classification: string;
  work?: string;
};

function dateToTime(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  return new Date(year, month - 1, day).getTime();
}

function NotesFilterBar({
  endDate,
  onClear,
  onEndDateChange,
  onStartDateChange,
  onStatusChange,
  onWorkChange,
  startDate,
  status,
  work,
  works,
}: {
  endDate: string;
  onClear: () => void;
  onEndDateChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onWorkChange: (value: string) => void;
  startDate: string;
  status: string;
  work: string;
  works: string[];
}) {
  return (
    <form className={noteStyles.filters} onReset={onClear}>
      <label>
        <span>Obra</span>
        <select
          value={work}
          onChange={(event) => onWorkChange(event.target.value)}
        >
          <option value="">Todas as obras</option>
          {works.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Período</legend>
        <div className={noteStyles.dateRange}>
          <Icon name="calendar" />
          <input
            aria-label="Data inicial"
            type="date"
            value={startDate}
            onChange={(event) => onStartDateChange(event.target.value)}
          />
          <span>—</span>
          <input
            aria-label="Data final"
            type="date"
            value={endDate}
            onChange={(event) => onEndDateChange(event.target.value)}
          />
        </div>
      </fieldset>
      <label>
        <span>Status</span>
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
        >
          <option value="">Todos</option>
          <option value="OK">OK</option>
          <option value="Suspeita">Suspeita</option>
          <option value="Em análise">Em análise</option>
        </select>
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
}: {
  role: PortalRole;
  userEmail?: string;
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
        action={<ReportExportButton role={role} />}
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
      <DashboardFilters role={role} />
      {admin ? <AdminDashboardPanels /> : <ReviewerDashboardPanels />}
    </PortalShell>
  );
}

function ReviewerDashboardPanels() {
  return (
    <section className={styles.dashboardGrid}>
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
              <strong>{n[3]}</strong>
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
          <Link href="/revisao/validacoes">
            <span>
              <Icon name="shield" /> Notas aguardando validação
            </span>
            <strong>198</strong>
            <Icon name="chevron" />
          </Link>
          <Link href="/revisao/validacoes">
            <span>
              <Icon name="warning" /> Suspeitas aguardando análise
            </span>
            <strong>142</strong>
            <Icon name="chevron" />
          </Link>
        </div>
        <Link className={styles.primaryAction} href="/revisao/validacoes">
          <Icon name="shield" /> Ir para Validações
        </Link>
      </article>
    </section>
  );
}

function AdminDashboardPanels() {
  return (
    <section className={styles.adminPanels}>
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Últimas validações do Rafael</h2>
          <Link href="/admin/validacoes">Ver todas</Link>
        </div>
        <ul className={styles.activityList}>
          {noteRows.slice(0, 5).map((n, i) => (
            <li key={n[5]}>
              <Icon name={i % 2 ? "warning" : "check"} />
              <span>
                <strong>{n[1]}</strong>
                <small>
                  {i % 2 ? "Nota classificada como suspeita" : "Nota validada"}
                </small>
              </span>
              <b>{n[3]}</b>
            </li>
          ))}
        </ul>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Obras recentes</h2>
          <Link href="/admin/obras">Ver todas</Link>
        </div>
        <ul className={styles.simpleList}>
          {workRows.slice(0, 5).map((w, i) => (
            <li key={w[1]}>
              <strong>{w[0]}</strong>
              <span>{624 - i * 74} notas</span>
              <b>R$ {(4.87 - i * 0.55).toFixed(2)} mi</b>
            </li>
          ))}
        </ul>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Atividade recente / logs resumidos</h2>
          <Link href="/admin/logs">Ver todos</Link>
        </div>
        <ul className={styles.activityList}>
          {logRows.map((l) => (
            <li key={l[1]}>
              <Icon name="shield" />
              <span>
                <strong>{l[2]}</strong>
                <small>{l[3]}</small>
              </span>
              <b>{l[0].split(" ")[0]}</b>
            </li>
          ))}
        </ul>
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
          work: n[6],
        }));
  const [work, setWork] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const rowTime = dateToTime(row.date);
        const startsAt = startDate
          ? new Date(`${startDate}T00:00:00`).getTime()
          : null;
        const endsAt = endDate
          ? new Date(`${endDate}T23:59:59`).getTime()
          : null;
        return (
          (!work || row.work === work) &&
          (!status || row.classification === status) &&
          (startsAt === null || rowTime >= startsAt) &&
          (endsAt === null || rowTime <= endsAt)
        );
      }),
    [endDate, rows, startDate, status, work],
  );
  const clearFilters = () => {
    setWork("");
    setStatus("");
    setStartDate("");
    setEndDate("");
  };
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
          footnote="↗ 12,8% vs. período anterior"
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
          footnote="↗ 18,7% vs. período anterior"
          tone="green"
        />
      </section>
      <NotesFilterBar
        endDate={endDate}
        onClear={clearFilters}
        onEndDateChange={setEndDate}
        onStartDateChange={setStartDate}
        onStatusChange={setStatus}
        onWorkChange={setWork}
        startDate={startDate}
        status={status}
        work={work}
        works={works}
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
            {filteredRows.map((n) => (
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
          {filteredRows.map((n) => (
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
          <Pagination total={filteredRows.length} />
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
  const queue: Array<NoteVisualItem & { state: string }> =
    items && items.length > 0
      ? items.map((item, index) => ({
          ...item,
          state:
            index === 0
              ? "danger"
              : item.classification === "OK"
                ? "ok"
                : "warning",
        }))
      : validationRows.map((item) => ({ ...item }));
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
        <article className={`${styles.panel} ${styles.validationQueue}`}>
          <div className={styles.panelHeader}>
            <h2>
              {role === "admin"
                ? "Validações realizadas pelo Rafael "
                : "Notas aguardando validação "}
              <StatusBadge tone="info">
                {items && items.length > 0 ? items.length : 198}
              </StatusBadge>
            </h2>
            <button>
              <Icon name="filter" /> Filtrar⌄
            </button>
          </div>
          <div className={styles.queueRows}>
            {queue.map((n, i) => (
              <Link
                href={n.id ? `/notas/${n.id}` : "#"}
                className={i === 0 ? styles.selectedQueue : undefined}
                key={n.id}
              >
                <span className={`${styles.queueState} ${styles[n.state]}`}>
                  <Icon name={n.state === "ok" ? "check" : "warning"} />
                </span>
                <div>
                  <strong>{n.supplier}</strong>
                  <small>Nº {n.number}</small>
                </div>
                <span>
                  <strong>{n.value}</strong>
                  <small>{n.date}</small>
                </span>
                <StatusBadge
                  tone={n.classification === "OK" ? "ok" : "warning"}
                >
                  {n.classification}
                </StatusBadge>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
        </article>
        <ValidationDetail readOnly={role === "admin"} />
      </section>
    </PortalShell>
  );
}

function ValidationDetail({ readOnly }: { readOnly: boolean }) {
  return (
    <article className={`${styles.panel} ${styles.validationDetail}`}>
      <div className={styles.panelHeader}>
        <h2>
          <span className={styles.documentDanger}>
            <Icon name="document" />
          </span>{" "}
          Detalhes da nota selecionada
        </h2>
        <Link href="/notas/demo-00012589">Ver nota fiscal ↗</Link>
      </div>
      <dl className={styles.noteSummary}>
        <div>
          <dt>Fornecedor</dt>
          <dd>Construtora Silva Ltda.</dd>
        </div>
        <div>
          <dt>Nº da nota</dt>
          <dd>00012589</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd className={styles.red}>R$ 249.200,00</dd>
        </div>
        <div>
          <dt>Emitida em</dt>
          <dd>28/05/2024</dd>
        </div>
      </dl>
      <section className={styles.aiBox}>
        <h3>
          Classificação sugerida pela IA{" "}
          <StatusBadge tone="warning">Suspeita</StatusBadge>
        </h3>
        <p>
          <Icon name="sparkles" /> A IA identificou divergências de preço e
          quantidade entre esta nota e históricos de compras similares.
        </p>
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
            “A quantidade executada está acima do medido em campo. Favor revisar
            as evidências.”
          </p>
        </section>
      ) : (
        <ValidationDecisionForm />
      )}
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

export function LogsView() {
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
          value="1.248"
          footnote="+12,5% vs. período anterior"
        />
        <MetricCard
          icon="check"
          label="Validações OK"
          value="842"
          footnote="67,6% do total"
          tone="green"
        />
        <MetricCard
          icon="warning"
          label="Validações suspeitas"
          value="284"
          footnote="22,8% do total"
          tone="orange"
        />
        <MetricCard
          icon="clock"
          label="Última atividade"
          value="Hoje, 10:35"
          footnote="28/05/2024 10:35:42"
          tone="purple"
        />
      </section>
      <LogsExplorer />
    </PortalShell>
  );
}

function Pagination({ total = 1248 }: { total?: number }) {
  return (
    <footer className={styles.pagination}>
      <span>
        1-{Math.min(10, total)} de {total.toLocaleString("pt-BR")}
      </span>
      <div className={styles.paginationNumbers}>
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>…</span>
        <span>156</span>
      </div>
      <span>Mostrar 10⌄</span>
    </footer>
  );
}

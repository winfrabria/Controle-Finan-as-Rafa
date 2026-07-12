import Link from "next/link";

import { AdminWorksClient } from "./admin-works-client";
import { logRows, noteRows, validationRows, workRows } from "./mock-data";
import { Icon } from "./ui-icons";
import {
  MetricCard,
  PageIntro,
  PortalShell,
  StatusBadge,
  type PortalRole,
} from "./portal-shell";
import styles from "./workspace-ui.module.css";

type NoteVisualItem = {
  id?: string;
  number: string;
  supplier: string;
  date: string;
  value: string;
  classification: string;
};

function FilterBar({ compact = false }: { compact?: boolean }) {
  return (
    <form className={styles.filterBar}>
      <label>
        Obra
        <select defaultValue="">
          <option value="">Todas as obras</option>
          <option>Projeto Piloto</option>
        </select>
      </label>
      <label>
        Período
        <span className={styles.selectLike}>
          <Icon name="calendar" /> 01/05/2024 - 31/05/2024
        </span>
      </label>
      {!compact && (
        <label>
          Status
          <select defaultValue="">
            <option value="">Todos</option>
            <option>OK</option>
            <option>Suspeita</option>
          </select>
        </label>
      )}
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
        action={
          <button>
            <Icon name="download" /> Exportar relatório
          </button>
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
      {!admin && <FilterBar compact />}
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
            <li key={n[0]}>
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
            <li key={n[0]}>
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
          number: n[0],
          supplier: n[1],
          date: n[2],
          value: n[3],
          classification: n[4],
        }));
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
      <section className={styles.notesMetrics}>
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
      <FilterBar />
      <section className={styles.panel}>
        <table className={styles.dataTable}>
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
            {rows.map((n) => (
              <tr key={n.number}>
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
                  <Link
                    href={n.id ? `/notas/${n.id}` : "#"}
                    className={styles.eyeButton}
                  >
                    <Icon name="eye" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.mobileCardsList}>
          {rows.map((n) => (
            <article className={styles.noteMobileCard} key={n.number}>
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
                <Link
                  href={n.id ? `/notas/${n.id}` : "#"}
                  className={styles.eyeButton}
                >
                  <Icon name="eye" />
                </Link>
              </aside>
            </article>
          ))}
        </div>
        <Pagination />
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
    items !== undefined
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
            ? "Revise e acompanhe as notas fiscais em validação."
            : "Revise e classifique as notas fiscais que aguardam sua validação."
        }
      />
      <section className={styles.validationGrid}>
        <article className={`${styles.panel} ${styles.validationQueue}`}>
          <div className={styles.panelHeader}>
            <h2>
              Notas aguardando validação{" "}
              <StatusBadge tone="info">{items?.length ?? 198}</StatusBadge>
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
                key={n.number}
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
        <ValidationDetail />
      </section>
    </PortalShell>
  );
}

function ValidationDetail() {
  return (
    <article className={`${styles.panel} ${styles.validationDetail}`}>
      <div className={styles.panelHeader}>
        <h2>
          <span className={styles.documentDanger}>
            <Icon name="document" />
          </span>{" "}
          Detalhes da nota selecionada
        </h2>
        <button>Ver nota fiscal ↗</button>
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
      <form className={styles.validationForm}>
        <fieldset>
          <legend>Sua classificação</legend>
          <label>
            <input type="radio" name="decision" />
            <span>
              <Icon name="check" />
              <strong>OK</strong>
              <small>Tudo conforme</small>
            </span>
          </label>
          <label>
            <input type="radio" name="decision" />
            <span>
              <Icon name="warning" />
              <strong>Suspeita</strong>
              <small>Requer atenção</small>
            </span>
          </label>
        </fieldset>
        <label>
          Motivo da classificação <b>*</b>
          <select defaultValue="">
            <option value="" disabled>
              Selecione o motivo
            </option>
            <option>Divergência de quantidade</option>
          </select>
        </label>
        <label>
          Comentário (opcional)
          <textarea
            placeholder="Descreva os principais pontos que levaram à sua decisão..."
            maxLength={500}
          />
          <small>0/500</small>
        </label>
        <button type="button">
          <Icon name="lock" /> Salvar validação
        </button>
      </form>
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
      <section className={styles.logsLayout}>
        <article>
          <FilterBar />
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
                </tr>
              </thead>
              <tbody>
                {logRows.map((l) => (
                  <tr key={l[0]}>
                    <td>{l[0]}</td>
                    <td>
                      <span className={styles.miniAvatar}>R</span> Rafael
                    </td>
                    <td>{l[1]}</td>
                    <td>{l[2]}</td>
                    <td>
                      <StatusBadge tone={l[4] === "OK" ? "ok" : "warning"}>
                        {l[4]}
                      </StatusBadge>
                    </td>
                    <td>{l[3]}</td>
                    <td>{l[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.mobileCardsList}>
              {logRows.map((l, i) => (
                <article
                  className={`${styles.logMobileCard} ${i === 0 ? styles.selectedLog : ""}`}
                  key={l[0]}
                >
                  <div>
                    <strong>{l[0]}</strong>
                    <span>
                      <i className={styles.miniAvatar}>R</i> Rafael
                      <br />
                      {l[1]}
                    </span>
                    <StatusBadge tone={l[4] === "OK" ? "ok" : "warning"}>
                      {l[4]}
                    </StatusBadge>
                    <Icon name="chevron" />
                  </div>
                  <dl>
                    <div>
                      <dt>Ação</dt>
                      <dd>{l[2]}</dd>
                    </div>
                    <div>
                      <dt>Motivo</dt>
                      <dd>{l[3]}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{l[4]}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <Pagination />
          </div>
        </article>
        <LogDetail />
      </section>
    </PortalShell>
  );
}

function LogDetail() {
  return (
    <aside className={`${styles.panel} ${styles.logDetail}`}>
      <div className={styles.panelHeader}>
        <h2>Detalhes do log</h2>×
      </div>
      <dl>
        <div>
          <dt>Data/hora</dt>
          <dd>28/05/2024 10:35:42</dd>
        </div>
        <div>
          <dt>Usuário</dt>
          <dd>Rafael</dd>
        </div>
        <div>
          <dt>Nº da nota</dt>
          <dd>00012589</dd>
        </div>
        <div>
          <dt>Ação</dt>
          <dd>Rafael marcou como Suspeita</dd>
        </div>
        <div>
          <dt>Classificação</dt>
          <dd>
            <StatusBadge tone="warning">Suspeita</StatusBadge>
          </dd>
        </div>
      </dl>
      <h3>Comentário do Rafael</h3>
      <p className={styles.comment}>
        “A quantidade executada informada na nota está acima do medido em campo.
        Favor revisar as medições e anexar evidências conforme procedimento.”
      </p>
      <h3>Linha do tempo</h3>
      <ol className={styles.timeline}>
        <li>
          <b>28/05/2024 10:35:42</b>Rafael marcou a nota como Suspeita
        </li>
        <li>
          <b>28/05/2024 10:28:19</b>Nota enviada para validação
        </li>
        <li>
          <b>28/05/2024 09:12:07</b>Nota fiscal emitida pelo fornecedor
        </li>
      </ol>
    </aside>
  );
}

function Pagination() {
  return (
    <footer className={styles.pagination}>
      <span>1-8 de 1.248</span>
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

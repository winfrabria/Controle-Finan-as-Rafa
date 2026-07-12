import Link from "next/link";

import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  PageIntro,
  PortalShell,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";

import { HistoryTrendChart } from "./history-trend-chart";
import type {
  ValidationHistoryAnalyticsItem,
  ValidationHistoryFilters,
  ValidationHistoryItem,
} from "./validation-history-query";
import { buildValidationHistoryPageHref } from "./validation-history-query";
import styles from "./validation-history-view.module.css";

type SearchParams = Record<string, string | string[] | undefined>;

type HistoryMeta = {
  analytics: ValidationHistoryAnalyticsItem[];
  confirmed: number;
  filters: ValidationHistoryFilters;
  hasStoredHistory: boolean;
  page: number;
  pageCount: number;
  released: number;
  total: number;
  works: { id: string; name: string }[];
};

const demoWorks = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Obra Piloto HWN" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Edifício Aurora" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Hospital Central" },
];

const demoRows: ValidationHistoryItem[] = [
  demoRow(1, "Construtora Silva Ltda.", "00012589", "Obra Piloto HWN", true, "Preço acima do histórico", 92),
  demoRow(2, "Transportes Ideal", "00012567", "Edifício Aurora", true, "Divergência de CNPJ", 88),
  demoRow(3, "MegaParafusos", "00012541", "Hospital Central", false, "Preço acima do histórico", 65),
  demoRow(4, "Locação Equip. Sul", "00012532", "Obra Piloto HWN", true, "Compatibilidade de item", 94),
  demoRow(5, "Hidráulica Prime", "00012498", "Edifício Aurora", false, "Valor fracionado", 60),
  demoRow(6, "Ferragens Brasil", "00012487", "Hospital Central", true, "Quantidade acima do histórico", 91),
];

const demoTrend = [
  { label: "Jan/26", rate: 58.1 },
  { label: "Fev/26", rate: 61.4 },
  { label: "Mar/26", rate: 63.2 },
  { label: "Abr/26", rate: 65.1 },
  { label: "Mai/26", rate: 66.7 },
];

function demoRow(
  index: number,
  supplierName: string,
  noteNumber: string,
  workName: string,
  aiCorrect: boolean,
  reason: string,
  confidence: number,
): ValidationHistoryItem {
  const work = demoWorks.find((item) => item.name === workName) ?? demoWorks[0];
  return {
    aiCorrect,
    comment:
      index % 2 === 0
        ? "Conferência concluída com os documentos da obra."
        : null,
    createdAt: new Date(2026, 4, 29 - index, 8 + index, 18),
    decision: aiCorrect ? "SUSPICION_CONFIRMED" : "FALSE_POSITIVE",
    findingTitle: reason,
    id: `demo-history-${index}`,
    noteId: `demo-note-${index}`,
    noteIssuedAt: new Date(2026, 4, 20 + index),
    noteNumber,
    readConfidence: confidence / 100,
    reason,
    reviewerEmail: "pdrarthoficial3@gmail.com",
    reviewerName: "Rafael",
    supplierName,
    totalAmount: String(12850 + index * 1375.42),
    workId: work.id,
    workName,
  };
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  timeZone: "America/Sao_Paulo",
  year: "2-digit",
});

export function ValidationHistoryView({
  items,
  meta,
  role,
  searchParams,
}: {
  items: ValidationHistoryItem[];
  meta: HistoryMeta;
  role: PortalRole;
  searchParams: SearchParams;
}) {
  const isDemo = !meta.hasStoredHistory;
  const works = meta.works.length ? meta.works : demoWorks;
  const demoData = demoRows.map((item, index) => ({
    ...item,
    workId: works[index % works.length].id,
    workName: works[index % works.length].name,
  }));
  const visibleItems = isDemo
    ? filterDemoRows(demoData, meta.filters)
    : items;
  const analytics = isDemo
    ? visibleItems.map(({ aiCorrect, createdAt, reason }) => ({
        aiCorrect,
        createdAt,
        reason,
      }))
    : meta.analytics;
  const confirmed = analytics.filter((item) => item.aiCorrect).length;
  const released = analytics.length - confirmed;
  const agreement = analytics.length
    ? (confirmed / analytics.length) * 100
    : 0;
  const trend = isDemo ? demoTrend : buildTrend(analytics);
  const trendDelta =
    trend.length > 1
      ? trend[trend.length - 1].rate - trend[trend.length - 2].rate
      : 0;
  const reasons = buildReasonRanking(analytics);
  const basePath = role === "admin" ? "/admin" : "/revisao";
  const pathname = `${basePath}/historico`;

  return (
    <PortalShell active="historico" role={role}>
      <div className={styles.page}>
        <PageIntro
          title="Histórico e qualidade da IA"
          description="Acompanhe o desempenho da IA nas validações e o aprendizado contínuo."
          action={
            isDemo ? (
              <span className={styles.demoBadge}>Dados de demonstração</span>
            ) : undefined
          }
        />

        <HistoryFilters
          filters={meta.filters}
          pathname={pathname}
          works={works}
        />

        <section className={styles.analyticsPanel} aria-label="Qualidade da IA">
          <article className={styles.metricCard}>
            <small>Taxa de concordância</small>
            <span>IA × humano</span>
            <strong>{formatPercent(agreement)}</strong>
            <em className={trendDelta >= 0 ? styles.positive : styles.negative}>
              {trendDelta >= 0 ? "▲" : "▼"} {formatSignedPercent(trendDelta)} vs. mês anterior
            </em>
          </article>
          <article className={styles.metricCard}>
            <small>Suspeitas confirmadas</small>
            <span>pelo revisor humano</span>
            <strong>{confirmed}</strong>
            <em>{formatPercent(agreement)} das suspeitas</em>
          </article>
          <article className={styles.metricCard}>
            <small>Falsos positivos</small>
            <span>IA marcou suspeita</span>
            <strong>{released}</strong>
            <em>{formatPercent(100 - agreement)} das suspeitas</em>
          </article>
          <article className={styles.chartCard}>
            <header>
              <strong>Concordância IA × humano</strong>
              <span>Tendência mensal</span>
            </header>
            <HistoryTrendChart points={trend} />
          </article>
        </section>

        <section className={styles.historySection}>
          <div className={styles.historyMain}>
            <header className={styles.sectionTitle}>
              <div>
                <h2>Linhas do tempo de validações</h2>
                <p>Últimas decisões concluídas no período</p>
              </div>
              <span>{isDemo ? "Demonstração" : `${meta.total} registro(s)`}</span>
            </header>

            {visibleItems.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Data e hora</th>
                      <th>Nota fiscal</th>
                      <th>Fornecedor</th>
                      <th>Regra disparada (IA)</th>
                      <th>Confiança da IA</th>
                      <th>Decisão humana</th>
                      <th>Motivo da decisão</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <HistoryRow key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <Icon name="filter" />
                <strong>Nenhuma validação encontrada</strong>
                <span>Ajuste obra ou período para consultar outros dados.</span>
              </div>
            )}

            <footer className={styles.tableFooter}>
              <span>Exibindo {visibleItems.length} validações</span>
              <div className={styles.legend}>
                <span><i className={styles.legendCorrect} /> IA acertou</span>
                <span><i className={styles.legendFalse} /> Falso positivo</span>
              </div>
              {!isDemo && meta.pageCount > 1 ? (
                <nav aria-label="Paginação">
                  {meta.page > 1 ? (
                    <Link href={buildValidationHistoryPageHref(pathname, searchParams, meta.page - 1)}>Anterior</Link>
                  ) : null}
                  <span>{meta.page}/{meta.pageCount}</span>
                  {meta.page < meta.pageCount ? (
                    <Link href={buildValidationHistoryPageHref(pathname, searchParams, meta.page + 1)}>Próxima</Link>
                  ) : null}
                </nav>
              ) : (
                <Link href={`${basePath}/validacoes`}>Ver validações <Icon name="chevron" /></Link>
              )}
            </footer>
          </div>

          <aside className={styles.reasonsPanel}>
            <header>
              <h2>Principais motivos</h2>
              <p>Por quantidade de ocorrências</p>
            </header>
            <div className={styles.reasonList}>
              {reasons.map((reason) => (
                <div key={reason.label}>
                  <span><strong>{reason.label}</strong><b>{reason.count}</b></span>
                  <progress max={reasons[0]?.count ?? 1} value={reason.count} />
                </div>
              ))}
            </div>
            <p className={styles.learningNote}>
              <Icon name="shield" />
              A IA aprende com as decisões humanas para reduzir falsos positivos e aumentar a precisão.
            </p>
          </aside>
        </section>
      </div>
    </PortalShell>
  );
}

function HistoryFilters({
  filters,
  pathname,
  works,
}: {
  filters: ValidationHistoryFilters;
  pathname: string;
  works: { id: string; name: string }[];
}) {
  return (
    <form action={pathname} method="get" className={styles.topFilters}>
      <label>
        <span>Obra</span>
        <span className={styles.controlShell}>
          <Icon name="building" />
          <select name="obra" defaultValue={filters.obra ?? ""}>
            <option value="">Todas as obras</option>
            {works.map((work) => (
              <option key={work.id} value={work.id}>{work.name}</option>
            ))}
          </select>
        </span>
      </label>
      <fieldset>
        <legend>Período</legend>
        <span className={styles.controlShell}>
          <Icon name="calendar" />
          <input aria-label="Data inicial" type="date" name="dataDe" defaultValue={filters.dataDe ?? ""} />
          <i>—</i>
          <input aria-label="Data final" type="date" name="dataAte" defaultValue={filters.dataAte ?? ""} />
        </span>
      </fieldset>
      <button type="submit"><Icon name="filter" /> Aplicar</button>
      <Link href={pathname}>Limpar</Link>
    </form>
  );
}

function HistoryRow({ item }: { item: ValidationHistoryItem }) {
  const confidence = confidencePercent(item.readConfidence);
  return (
    <tr>
      <td>{dateTimeFormatter.format(item.createdAt)}</td>
      <td>
        <Link className={styles.noteLink} href={`/notas/${item.noteId}`}>
          <Icon name="document" /> {item.noteNumber ?? "Sem número"}
        </Link>
      </td>
      <td title={item.supplierName ?? undefined}>{item.supplierName ?? "Não identificado"}</td>
      <td><span className={styles.ruleText}>{item.findingTitle ?? item.reason}</span></td>
      <td>
        <span className={styles.confidence}>
          <b>{confidence === null ? "—" : `${confidence}%`}</b>
          <progress max="100" value={confidence ?? 0} />
        </span>
      </td>
      <td><DecisionBadge confirmed={item.aiCorrect} /></td>
      <td title={item.comment ? `${item.reason} — ${item.comment}` : item.reason}>
        <span className={styles.reasonText}>{item.reason}</span>
      </td>
      <td><ResultBadge confirmed={item.aiCorrect} /></td>
    </tr>
  );
}

function DecisionBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span className={`${styles.decisionBadge} ${confirmed ? styles.confirmDecision : styles.releaseDecision}`}>
      {confirmed ? "Confirma suspeita" : "Descarta suspeita"}
    </span>
  );
}

function ResultBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span className={`${styles.resultBadge} ${confirmed ? styles.correctResult : styles.falseResult}`}>
      <Icon name={confirmed ? "check" : "warning"} />
      {confirmed ? "IA acertou" : "Falso positivo"}
    </span>
  );
}

function confidencePercent(value: number | null) {
  if (value === null) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

function buildTrend(rows: ValidationHistoryAnalyticsItem[]) {
  const months = new Map<string, { confirmed: number; date: Date; total: number }>();
  for (const row of rows) {
    const date = new Date(row.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const current = months.get(key) ?? { confirmed: 0, date, total: 0 };
    current.total += 1;
    if (row.aiCorrect) current.confirmed += 1;
    months.set(key, current);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-5)
    .map(([, value]) => ({
      label: monthFormatter.format(value.date).replace(" de ", "/"),
      rate: Number(((value.confirmed / value.total) * 100).toFixed(1)),
    }));
}

function buildReasonRanking(rows: ValidationHistoryAnalyticsItem[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.reason || "Sem motivo informado";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

function formatSignedPercent(value: number) {
  const absolute = Math.abs(value);
  return `${absolute.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} p.p.`;
}

function filterDemoRows(
  rows: ValidationHistoryItem[],
  filters: ValidationHistoryFilters,
) {
  return rows.filter((item) => {
    if (filters.obra && item.workId !== filters.obra) return false;
    if (filters.dataDe && item.createdAt < new Date(`${filters.dataDe}T00:00:00-03:00`)) return false;
    if (filters.dataAte && item.createdAt > new Date(`${filters.dataAte}T23:59:59.999-03:00`)) return false;
    return true;
  });
}

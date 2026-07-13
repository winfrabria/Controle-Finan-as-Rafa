import Link from "next/link";

import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  PageIntro,
  PortalShell,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";

import type {
  ValidationHistoryFilters,
  ValidationHistoryItem,
  ValidationHistoryResult,
} from "./validation-history-query";
import { buildValidationHistoryPageHref } from "./validation-history-query";
import styles from "./validation-history-view.module.css";

type SearchParams = Record<string, string | string[] | undefined>;

type HistoryMeta = {
  confirmed: number;
  filters: ValidationHistoryFilters;
  overallTotal: number;
  page: number;
  pageCount: number;
  released: number;
  selectedItem: ValidationHistoryItem | null;
  total: number;
  works: { id: string; name: string }[];
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
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
  const basePath = role === "admin" ? "/admin" : "/revisao";
  const pathname = `${basePath}/historico`;
  const confirmationRate = percentage(meta.confirmed, meta.overallTotal);
  const releasedRate = percentage(meta.released, meta.overallTotal);

  return (
    <PortalShell active="historico" role={role}>
      <div className={styles.page}>
        <PageIntro
          title="Histórico de validações"
          description="Consulte decisões já finalizadas e revise os detalhes de cada validação."
        />

        <section className={styles.metrics} aria-label="Resumo do histórico">
          <MetricCard
            icon="document"
            label="Decisões finalizadas"
            tone="blue"
            value={meta.overallTotal.toLocaleString("pt-BR")}
          />
          <MetricCard
            icon="check"
            label="Taxa de confirmação (IA acertou)"
            tone="green"
            value={formatPercent(confirmationRate)}
          />
          <MetricCard
            icon="warning"
            label="Falsos positivos (IA suspeitou e foi liberada)"
            tone="orange"
            value={formatPercent(releasedRate)}
          />
        </section>

        <section className={styles.workspace}>
          <div className={styles.listPanel}>
            <HistorySearch
              filters={meta.filters}
              pathname={pathname}
            />
            <HistoryTabs
              filters={meta.filters}
              pathname={pathname}
              searchParams={searchParams}
            />

            {items.length ? (
              <div className={styles.historyList}>
                {items.map((item) => (
                  <HistoryListItem
                    active={item.id === meta.selectedItem?.id}
                    item={item}
                    key={item.id}
                    pathname={pathname}
                    searchParams={searchParams}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyList}>
                <Icon name="search" />
                <strong>Nenhuma validação encontrada</strong>
                <span>Tente outro número de nota, fornecedor ou obra.</span>
              </div>
            )}

            <HistoryPagination
              meta={meta}
              pathname={pathname}
              searchParams={searchParams}
            />
          </div>

          <ValidationDetail item={meta.selectedItem} />
        </section>
      </div>
    </PortalShell>
  );
}

function MetricCard({
  icon,
  label,
  tone,
  value,
}: {
  icon: "check" | "document" | "warning";
  label: string;
  tone: "blue" | "green" | "orange";
  value: string;
}) {
  return (
    <article className={styles.metricCard}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <i className={styles[tone]}><Icon name={icon} /></i>
    </article>
  );
}

function HistorySearch({
  filters,
  pathname,
}: {
  filters: ValidationHistoryFilters;
  pathname: string;
}) {
  return (
    <form action={pathname} className={styles.searchForm} method="get">
      {filters.resultado ? (
        <input name="resultado" type="hidden" value={filters.resultado} />
      ) : null}
      <label>
        <Icon name="search" />
        <input
          aria-label="Buscar no histórico"
          defaultValue={filters.busca ?? ""}
          name="busca"
          placeholder="Buscar no histórico..."
          type="search"
        />
      </label>
      <button aria-label="Buscar" type="submit"><Icon name="filter" /></button>
    </form>
  );
}

function HistoryTabs({
  filters,
  pathname,
  searchParams,
}: {
  filters: ValidationHistoryFilters;
  pathname: string;
  searchParams: SearchParams;
}) {
  const tabs: Array<{ label: string; value?: ValidationHistoryResult }> = [
    { label: "Todas" },
    { label: "IA acertou", value: "confirmed" },
    { label: "Liberadas", value: "released" },
  ];

  return (
    <nav className={styles.tabs} aria-label="Filtrar resultado da validação">
      {tabs.map((tab) => (
        <Link
          aria-current={filters.resultado === tab.value ? "page" : undefined}
          className={filters.resultado === tab.value ? styles.activeTab : undefined}
          href={historyHref(pathname, searchParams, {
            pagina: null,
            resultado: tab.value ?? null,
            validacao: null,
          })}
          key={tab.label}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function HistoryListItem({
  active,
  item,
  pathname,
  searchParams,
}: {
  active: boolean;
  item: ValidationHistoryItem;
  pathname: string;
  searchParams: SearchParams;
}) {
  return (
    <Link
      className={`${styles.historyItem} ${active ? styles.activeItem : ""}`}
      href={historyHref(pathname, searchParams, { validacao: item.id })}
    >
      <span className={`${styles.resultIcon} ${item.aiCorrect ? styles.confirmedIcon : styles.releasedIcon}`}>
        <Icon name={item.aiCorrect ? "check" : "warning"} />
      </span>
      <span className={styles.noteIdentity}>
        <strong>{item.noteNumber ?? "Sem número"}</strong>
        <b>{item.supplierName ?? "Fornecedor não identificado"}</b>
        <small>{item.workName}</small>
      </span>
      <span className={styles.itemMeta}>
        <time dateTime={item.createdAt.toISOString()}>{dateFormatter.format(item.createdAt)}</time>
        <DecisionPill confirmed={item.aiCorrect} />
      </span>
      <Icon className={styles.itemChevron} name="chevron" />
    </Link>
  );
}

function HistoryPagination({
  meta,
  pathname,
  searchParams,
}: {
  meta: HistoryMeta;
  pathname: string;
  searchParams: SearchParams;
}) {
  const first = meta.total ? (meta.page - 1) * 6 + 1 : 0;
  const last = Math.min(meta.page * 6, meta.total);

  return (
    <footer className={styles.pagination}>
      <span>{first}-{last} de {meta.total.toLocaleString("pt-BR")}</span>
      <nav aria-label="Paginação do histórico">
        {meta.page > 1 ? (
          <Link aria-label="Página anterior" href={buildValidationHistoryPageHref(pathname, searchParams, meta.page - 1)}>‹</Link>
        ) : <span aria-hidden="true">‹</span>}
        <b>{meta.page}</b>
        <small>de {meta.pageCount}</small>
        {meta.page < meta.pageCount ? (
          <Link aria-label="Próxima página" href={buildValidationHistoryPageHref(pathname, searchParams, meta.page + 1)}>›</Link>
        ) : <span aria-hidden="true">›</span>}
      </nav>
    </footer>
  );
}

function ValidationDetail({ item }: { item: ValidationHistoryItem | null }) {
  if (!item) {
    return (
      <div className={styles.detailEmpty}>
        <Icon name="document" />
        <strong>Selecione uma validação</strong>
        <span>Os detalhes da decisão aparecerão aqui.</span>
      </div>
    );
  }

  return (
    <article className={styles.detailPanel}>
      <header className={styles.detailHeader}>
        <div>
          <span className={`${styles.resultIcon} ${item.aiCorrect ? styles.confirmedIcon : styles.releasedIcon}`}>
            <Icon name={item.aiCorrect ? "check" : "warning"} />
          </span>
          <span>
            <strong>Decisão final: <b>{item.aiCorrect ? "Suspeita" : "OK"}</b></strong>
            <small>
              Nota {item.noteNumber ?? "sem número"} <i>•</i> {item.supplierName ?? "Fornecedor não identificado"} <i>•</i> {item.workName}
            </small>
          </span>
        </div>
        <time dateTime={item.createdAt.toISOString()}>{dateFormatter.format(item.createdAt)}</time>
        <Link href={`/notas/${item.noteId}`}>Abrir nota detalhada <Icon name="chevron" /></Link>
      </header>

      <div className={styles.comparison}>
        <section className={styles.aiDecision}>
          <header>Suspeita indicada pela IA</header>
          <div>
            <small>Classificação sugerida</small>
            <span className={styles.suspectPill}>Suspeita</span>
            <hr />
            <small>Motivo principal</small>
            <strong>{item.findingTitle ?? item.reason}</strong>
            {item.findingJustification ? <p>{item.findingJustification}</p> : null}
            {item.findingSource ? <em>{sourceLabel(item.findingSource)}</em> : null}
          </div>
        </section>

        <span className={styles.versus}>VS</span>

        <section className={styles.humanDecision}>
          <header>Decisão humana</header>
          <div>
            <small>Decisão do revisor</small>
            <DecisionPill confirmed={item.aiCorrect} />
            <hr />
            <small>Resultado</small>
            <strong>
              {item.aiCorrect
                ? "O revisor confirmou o apontamento da IA."
                : "A nota foi liberada após a revisão humana."}
            </strong>
            <span className={styles.agreement}>
              Concordância com a IA <b>{item.aiCorrect ? "Sim" : "Não"}</b>
            </span>
          </div>
        </section>
      </div>

      <section className={styles.decisionDetails}>
        <DetailLine icon="shield" label="Motivo da decisão">
          {item.reason}
        </DetailLine>
        <DetailLine icon="document" label="Evidência utilizada">
          {item.findingEvidence.length ? (
            <ul>{item.findingEvidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
          ) : (
            item.findingJustification ?? "Nenhuma evidência adicional foi registrada."
          )}
        </DetailLine>
        <DetailLine icon="more" label="Comentário do revisor">
          {item.comment ?? "Nenhum comentário foi registrado."}
        </DetailLine>
      </section>

      <footer className={styles.auditFooter}>
        <div>
          <small>Revisor</small>
          <span className={styles.avatar}>{initials(item.reviewerName ?? item.reviewerEmail)}</span>
          <strong>{item.reviewerName ?? item.reviewerEmail}</strong>
          {item.reviewerName ? <em>{item.reviewerEmail}</em> : null}
        </div>
        <div>
          <small>Data da revisão</small>
          <strong><Icon name="calendar" /> {dateTimeFormatter.format(item.createdAt)}</strong>
        </div>
        <div>
          <small>ID da validação</small>
          <strong>{item.id}</strong>
        </div>
      </footer>
    </article>
  );
}

function DetailLine({
  children,
  icon,
  label,
}: {
  children: React.ReactNode;
  icon: "document" | "more" | "shield";
  label: string;
}) {
  return (
    <div className={styles.detailLine}>
      <span><Icon name={icon} /></span>
      <div><strong>{label}</strong><div>{children}</div></div>
    </div>
  );
}

function DecisionPill({ confirmed }: { confirmed: boolean }) {
  return (
    <span className={`${styles.decisionPill} ${confirmed ? styles.suspectPill : styles.okPill}`}>
      {confirmed ? "Suspeita" : "OK"}
    </span>
  );
}

function historyHref(
  pathname: string,
  params: SearchParams,
  changes: Record<string, string | null>,
) {
  const next = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function percentage(part: number, total: number) {
  return total ? (part / total) * 100 : 0;
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    AI_DISCOVERY: "Descoberta adicional da IA",
    UNIVERSAL_RULE: "Regra universal",
    WORK_RULE: "Regra da obra",
  };
  return labels[source] ?? source.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function initials(value: string) {
  return value
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

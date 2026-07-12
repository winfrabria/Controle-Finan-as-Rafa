import Link from "next/link";

import type {
  ValidationHistoryFilters,
  ValidationHistoryItem,
  ValidationHistoryResult,
} from "./validation-history-query";
import { buildValidationHistoryPageHref } from "./validation-history-query";
import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  PageIntro,
  PortalShell,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";

import styles from "./validation-history-view.module.css";

type SearchParams = Record<string, string | string[] | undefined>;

type HistoryMeta = {
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
  demoRow(1, "Construtora Silva Ltda.", "00012589", "Obra Piloto HWN", true, "Divergência de quantidade confirmada", "Rafael"),
  demoRow(2, "Transportes Ideal", "00012567", "Edifício Aurora", false, "Documentação complementar comprovou a compra", "Rafael"),
  demoRow(3, "MegaParafusos", "00012541", "Hospital Central", true, "Preço acima da referência cadastral", "Rafael"),
  demoRow(4, "Locação Equip. Sul", "00012532", "Obra Piloto HWN", true, "Item não previsto no contrato", "Rafael"),
  demoRow(5, "Hidráulica Prime", "00012498", "Edifício Aurora", false, "Quantidade compatível com a medição aprovada", "Rafael"),
  demoRow(6, "Ferragens Brasil", "00012487", "Hospital Central", true, "Valor do cupom diferente da nota", "Rafael"),
];

function demoRow(
  index: number,
  supplierName: string,
  noteNumber: string,
  workName: string,
  aiCorrect: boolean,
  reason: string,
  reviewerName: string,
): ValidationHistoryItem {
  const work = demoWorks.find((item) => item.name === workName) ?? demoWorks[0];
  return {
    aiCorrect,
    comment: index % 2 === 0 ? "Conferência concluída com os documentos da obra." : null,
    createdAt: new Date(2026, 6, 11 - index, 9 + index, 15),
    decision: aiCorrect ? "SUSPICION_CONFIRMED" : "FALSE_POSITIVE",
    findingTitle: reason,
    id: `demo-history-${index}`,
    noteId: `demo-note-${index}`,
    noteIssuedAt: new Date(2026, 6, 2 + index),
    noteNumber,
    reason,
    reviewerEmail: "pdrarthoficial3@gmail.com",
    reviewerName,
    supplierName,
    totalAmount: String(12850 + index * 1375.42),
    workId: work.id,
    workName,
  };
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
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
  const isDemo = !meta.hasStoredHistory;
  const works = meta.works.length ? meta.works : demoWorks;
  const selectedResult = meta.filters.resultado;
  const visibleItems = isDemo
    ? filterDemoRows(demoRows, meta.filters)
    : items;
  const confirmed = isDemo
    ? visibleItems.filter((item) => item.aiCorrect).length
    : meta.confirmed;
  const released = isDemo
    ? visibleItems.filter((item) => !item.aiCorrect).length
    : meta.released;
  const totalCompared = confirmed + released;
  const accuracy = totalCompared
    ? Math.round((confirmed / totalCompared) * 100)
    : 0;
  const basePath = role === "admin" ? "/admin" : "/revisao";
  const pathname = `${basePath}/historico`;

  return (
    <PortalShell active="historico" role={role}>
      <div className={styles.page}>
        <PageIntro
          title="Histórico de validações"
          description="Compare a suspeita indicada pela IA com a decisão humana registrada."
          action={
            isDemo ? (
              <span className={styles.demoBadge}>Dados de demonstração</span>
            ) : undefined
          }
        />

        <section className={styles.metrics} aria-label="Indicadores do histórico">
          <article>
            <span className={`${styles.metricIcon} ${styles.blue}`}>
              <Icon name="shield" />
            </span>
            <div><small>Validações analisadas</small><strong>{totalCompared}</strong></div>
          </article>
          <article>
            <span className={`${styles.metricIcon} ${styles.green}`}>
              <Icon name="check" />
            </span>
            <div><small>IA confirmou a suspeita</small><strong>{confirmed}</strong></div>
          </article>
          <article>
            <span className={`${styles.metricIcon} ${styles.orange}`}>
              <Icon name="warning" />
            </span>
            <div><small>Liberadas pelo revisor</small><strong>{released}</strong></div>
          </article>
          <article>
            <span className={`${styles.metricIcon} ${styles.purple}`}>
              <Icon name="document" />
            </span>
            <div><small>Precisão da suspeita da IA</small><strong>{accuracy}%</strong></div>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Decisões concluídas</h2>
              <span>{isDemo ? visibleItems.length : meta.total} registro(s)</span>
            </div>
            <HistoryFilters
              filters={meta.filters}
              pathname={pathname}
              selectedResult={selectedResult}
              works={works}
            />
          </div>

          {visibleItems.length ? (
            <>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Nota e fornecedor</th>
                      <th>Obra</th>
                      <th>Decisão humana</th>
                      <th>Motivo</th>
                      <th>Revisor</th>
                      <th>Validada em</th>
                      <th aria-label="Ação" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <HistoryRow key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.mobileList}>
                {visibleItems.map((item) => (
                  <HistoryCard key={item.id} item={item} />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <Icon name="filter" />
              <strong>Nenhuma validação encontrada</strong>
              <span>Ajuste os filtros para consultar outro período.</span>
            </div>
          )}

          {!isDemo && meta.pageCount > 1 ? (
            <nav className={styles.pagination} aria-label="Paginação">
              <span>Página {meta.page} de {meta.pageCount}</span>
              <div>
                {meta.page > 1 ? (
                  <Link href={buildValidationHistoryPageHref(pathname, searchParams, meta.page - 1)}>Anterior</Link>
                ) : <span>Anterior</span>}
                {meta.page < meta.pageCount ? (
                  <Link href={buildValidationHistoryPageHref(pathname, searchParams, meta.page + 1)}>Próxima</Link>
                ) : <span>Próxima</span>}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </PortalShell>
  );
}

function HistoryFilters({
  filters,
  pathname,
  selectedResult,
  works,
}: {
  filters: ValidationHistoryFilters;
  pathname: string;
  selectedResult?: ValidationHistoryResult;
  works: { id: string; name: string }[];
}) {
  return (
    <form action={pathname} method="get" className={styles.filters}>
      <label>
        <span>Obra</span>
        <select name="obra" defaultValue={filters.obra ?? ""}>
          <option value="">Todas</option>
          {works.map((work) => <option key={work.id} value={work.id}>{work.name}</option>)}
        </select>
      </label>
      <label>
        <span>De</span>
        <input type="date" name="dataDe" defaultValue={filters.dataDe ?? ""} />
      </label>
      <label>
        <span>Até</span>
        <input type="date" name="dataAte" defaultValue={filters.dataAte ?? ""} />
      </label>
      <label>
        <span>Resultado</span>
        <select name="resultado" defaultValue={selectedResult ?? ""}>
          <option value="">Todos</option>
          <option value="confirmed">Suspeita confirmada</option>
          <option value="released">Liberada pelo revisor</option>
        </select>
      </label>
      <button type="submit"><Icon name="filter" /> Aplicar</button>
      <Link href={pathname}>Limpar</Link>
    </form>
  );
}

function HistoryRow({ item }: { item: ValidationHistoryItem }) {
  return (
    <tr>
      <td>
        <span className={styles.noteIdentity}>
          <span className={`${styles.noteIcon} ${item.aiCorrect ? styles.confirmedIcon : styles.releasedIcon}`}>
            <Icon name={item.aiCorrect ? "warning" : "check"} />
          </span>
          <span><strong>NF {item.noteNumber ?? "Sem número"}</strong><small>{item.supplierName ?? "Fornecedor não identificado"}</small></span>
        </span>
      </td>
      <td title={item.workName}>{item.workName}</td>
      <td><ResultBadge confirmed={item.aiCorrect} /></td>
      <td title={item.comment ? `${item.reason} — ${item.comment}` : item.reason}>
        <span className={styles.reason}>{item.reason}</span>
      </td>
      <td title={item.reviewerEmail}>{item.reviewerName ?? item.reviewerEmail}</td>
      <td>{dateTimeFormatter.format(item.createdAt)}</td>
      <td><Link className={styles.detailLink} href={`/notas/${item.noteId}`} aria-label={`Abrir nota ${item.noteNumber ?? "sem número"}`}><Icon name="chevron" /></Link></td>
    </tr>
  );
}

function HistoryCard({ item }: { item: ValidationHistoryItem }) {
  return (
    <article>
      <header><span><strong>NF {item.noteNumber ?? "Sem número"}</strong><small>{item.supplierName ?? "Fornecedor não identificado"}</small></span><ResultBadge confirmed={item.aiCorrect} /></header>
      <dl>
        <div><dt>Obra</dt><dd>{item.workName}</dd></div>
        <div><dt>Motivo</dt><dd>{item.reason}</dd></div>
        <div><dt>Revisor</dt><dd>{item.reviewerName ?? item.reviewerEmail}</dd></div>
        <div><dt>Validação</dt><dd>{dateFormatter.format(item.createdAt)}</dd></div>
      </dl>
      <Link href={`/notas/${item.noteId}`}>Abrir nota <Icon name="chevron" /></Link>
    </article>
  );
}

function ResultBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span className={`${styles.resultBadge} ${confirmed ? styles.confirmed : styles.released}`}>
      <Icon name={confirmed ? "warning" : "check"} />
      {confirmed ? "Suspeita confirmada" : "Liberada"}
    </span>
  );
}

function filterDemoRows(rows: ValidationHistoryItem[], filters: ValidationHistoryFilters) {
  return rows.filter((item) => {
    if (filters.obra && item.workId !== filters.obra) return false;
    if (filters.resultado === "confirmed" && !item.aiCorrect) return false;
    if (filters.resultado === "released" && item.aiCorrect) return false;
    if (filters.dataDe && item.createdAt < new Date(`${filters.dataDe}T00:00:00-03:00`)) return false;
    if (filters.dataAte && item.createdAt > new Date(`${filters.dataAte}T23:59:59.999-03:00`)) return false;
    return true;
  });
}

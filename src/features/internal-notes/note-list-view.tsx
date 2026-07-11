import Link from "next/link";

import {
  NoteClassification,
  NoteStatus,
} from "@/generated/prisma/enums";

import {
  buildPageHref,
  type NoteListFilters,
  type NoteListItem,
} from "./note-list-query";
import styles from "./internal-notes.module.css";

type SearchParams = Record<string, string | string[] | undefined>;

type NoteListViewProps = {
  filters: NoteListFilters;
  items: NoteListItem[];
  page: number;
  pageCount: number;
  pathname: "/notas" | "/validacoes";
  searchParams: SearchParams;
  total: number;
  validationOnly?: boolean;
  works: { id: string; name: string }[];
};

const STATUS_LABELS: Record<NoteStatus, string> = {
  APPROVED: "Aprovada",
  FAILED: "Erro técnico",
  OK: "OK",
  PENDING_VALIDATION: "Pendente",
  PROCESSING: "Processando",
  READ_FAILED: "Falha de leitura",
  RECEIVED: "Recebida",
  REJECTED: "Rejeitada",
};

const CLASSIFICATION_LABELS: Record<NoteClassification, string> = {
  INCOMPATIBLE: "Incompatível",
  OK: "OK",
  SUSPICIOUS: "Suspeita",
};

function formatMoney(value: string | null) {
  if (!value) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(value);
}

function statusTone(status: NoteStatus) {
  if (status === NoteStatus.OK || status === NoteStatus.APPROVED) return styles.successBadge;
  if (status === NoteStatus.PENDING_VALIDATION) return styles.warningBadge;
  if (status === NoteStatus.READ_FAILED || status === NoteStatus.FAILED || status === NoteStatus.REJECTED) return styles.dangerBadge;
  return styles.infoBadge;
}

function NoteCard({ item, validationOnly }: { item: NoteListItem; validationOnly: boolean }) {
  return (
    <article className={`${styles.noteCard} ${validationOnly ? styles.pendingCard : ""}`}>
      <div className={styles.cardTopline}>
        <span className={`${styles.badge} ${statusTone(item.status)}`}>
          {STATUS_LABELS[item.status]}
        </span>
        <span>{formatDate(item.issuedAt ?? item.createdAt)}</span>
      </div>
      <h2>{item.documentNumber ? `Nota ${item.documentNumber}` : "Nota sem número"}</h2>
      <p className={styles.supplier}>{item.supplierName ?? "Fornecedor não identificado"}</p>
      <dl className={styles.cardDetails}>
        <div><dt>Obra</dt><dd>{item.workName}</dd></div>
        <div><dt>Valor</dt><dd>{formatMoney(item.totalAmount)}</dd></div>
        <div><dt>Classificação</dt><dd>{item.classification ? CLASSIFICATION_LABELS[item.classification] : "—"}</dd></div>
      </dl>
      {validationOnly ? (
        <div className={styles.findingSummary}>
          <strong>{item.findingCount} {item.findingCount === 1 ? "pendência" : "pendências"}</strong>
          <span>{item.primaryFinding ?? "Revisão humana necessária"}</span>
        </div>
      ) : null}
      <Link className={styles.openButton} href={`/notas/${item.id}`}>
        {validationOnly ? "Analisar nota" : "Abrir nota"} <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function NoteListView({
  filters,
  items,
  page,
  pageCount,
  pathname,
  searchParams,
  total,
  validationOnly = false,
  works,
}: NoteListViewProps) {
  return (
    <>
      <section className={styles.summaryGrid} aria-label="Resumo">
        <div className={styles.summaryCard}>
          <span>{validationOnly ? "Pendências encontradas" : "Resultados"}</span>
          <strong>{total}</strong>
          <small>{validationOnly ? "Aguardando decisão humana" : "Notas conforme os filtros"}</small>
        </div>
        {validationOnly ? (
          <div className={`${styles.summaryCard} ${styles.attentionSummary}`}>
            <span>Prioridade</span><strong>Revisar</strong><small>Mais antigas aparecem primeiro na fila</small>
          </div>
        ) : (
          <div className={styles.summaryCard}>
            <span>Página atual</span><strong>{page}</strong><small>de {pageCount} página(s)</small>
          </div>
        )}
      </section>

      <form className={styles.filters} method="get">
        <div className={styles.filterHeading}>
          <div><strong>Filtros</strong><span>Refine a consulta sem perder o contexto</span></div>
          <Link href={pathname}>Limpar filtros</Link>
        </div>
        <div className={styles.filterGrid}>
          <label><span>Obra</span><select name="obra" defaultValue={filters.obra ?? ""}><option value="">Todas as obras</option>{works.map((work) => <option key={work.id} value={work.id}>{work.name}</option>)}</select></label>
          {!validationOnly ? <label><span>Status</span><select name="status" defaultValue={filters.status ?? ""}><option value="">Todos os status</option>{Object.values(NoteStatus).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label> : null}
          <label><span>Classificação</span><select name="classificacao" defaultValue={filters.classificacao ?? ""}><option value="">Todas</option>{Object.values(NoteClassification).map((classification) => <option key={classification} value={classification}>{CLASSIFICATION_LABELS[classification]}</option>)}</select></label>
          <label><span>Fornecedor</span><input name="fornecedor" defaultValue={filters.fornecedor ?? ""} placeholder="Nome do fornecedor" /></label>
          <label><span>Data inicial</span><input name="dataDe" type="date" defaultValue={filters.dataDe ?? ""} /></label>
          <label><span>Data final</span><input name="dataAte" type="date" defaultValue={filters.dataAte ?? ""} /></label>
          <label><span>Valor mínimo</span><input min="0" name="valorMin" step="0.01" type="number" defaultValue={filters.valorMin ?? ""} placeholder="R$ 0,00" /></label>
          <label><span>Valor máximo</span><input min="0" name="valorMax" step="0.01" type="number" defaultValue={filters.valorMax ?? ""} placeholder="Sem limite" /></label>
        </div>
        <button className={styles.filterButton} type="submit">Aplicar filtros</button>
      </form>

      {items.length === 0 ? (
        <section className={styles.emptyState}>
          <span aria-hidden="true">{validationOnly ? "✓" : "▤"}</span>
          <h2>{validationOnly ? "Nenhuma validação pendente" : "Nenhuma nota encontrada"}</h2>
          <p>{validationOnly ? "A fila está limpa para os filtros selecionados." : "Ajuste os filtros ou envie uma nova nota para começar."}</p>
          <Link href={validationOnly ? "/validacoes" : "/"}>{validationOnly ? "Limpar filtros" : "Enviar uma nota"}</Link>
        </section>
      ) : (
        <>
          <section className={styles.desktopTable} aria-label={validationOnly ? "Notas aguardando validação" : "Notas"}>
            <table>
              <thead><tr><th>Nota / fornecedor</th><th>Obra</th><th>Emissão</th><th>Valor</th><th>Status</th>{validationOnly ? <th>Pendência</th> : <th>Classificação</th>}<th><span className={styles.srOnly}>Ação</span></th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id} className={validationOnly ? styles.pendingRow : undefined}><td><strong>{item.documentNumber ?? "Sem número"}</strong><span>{item.supplierName ?? "Fornecedor não identificado"}</span></td><td>{item.workName}</td><td>{formatDate(item.issuedAt ?? item.createdAt)}</td><td><strong>{formatMoney(item.totalAmount)}</strong></td><td><span className={`${styles.badge} ${statusTone(item.status)}`}>{STATUS_LABELS[item.status]}</span></td><td>{validationOnly ? <span className={styles.tableFinding}><strong>{item.findingCount}</strong>{item.primaryFinding ?? "Revisão necessária"}</span> : item.classification ? CLASSIFICATION_LABELS[item.classification] : "—"}</td><td><Link className={styles.tableAction} href={`/notas/${item.id}`}>{validationOnly ? "Analisar" : "Abrir"} →</Link></td></tr>)}</tbody>
            </table>
          </section>
          <section className={styles.mobileCards} aria-label={validationOnly ? "Notas aguardando validação" : "Notas"}>
            {items.map((item) => <NoteCard key={item.id} item={item} validationOnly={validationOnly} />)}
          </section>
        </>
      )}

      {pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="Paginação">
          {page > 1 ? <Link href={buildPageHref(pathname, searchParams, page - 1)}>← Anterior</Link> : <span aria-disabled="true">← Anterior</span>}
          <strong>Página {page} de {pageCount}</strong>
          {page < pageCount ? <Link href={buildPageHref(pathname, searchParams, page + 1)}>Próxima →</Link> : <span aria-disabled="true">Próxima →</span>}
        </nav>
      ) : null}
    </>
  );
}

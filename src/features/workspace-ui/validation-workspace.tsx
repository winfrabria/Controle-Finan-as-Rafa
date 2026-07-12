"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import { PageIntro, PortalShell, StatusBadge } from "./portal-shell";
import { ValidationDecisionForm } from "./validation-decision-form";
import styles from "./validation-workspace.module.css";

export type ValidationQueueItem = {
  classification: string;
  date: string;
  finding?: string;
  id: string;
  number: string;
  supplier: string;
  value: string;
  work?: string;
  workId?: string;
};

export type ValidationMeta = {
  filters: {
    dataAte?: string;
    dataDe?: string;
    obra?: string;
  };
  page: number;
  pageCount: number;
  total: number;
  works: Array<{ id: string; name: string }>;
};

function pageHref(page: number, filters: ValidationMeta["filters"]) {
  const params = new URLSearchParams();
  if (filters.obra) params.set("obra", filters.obra);
  if (filters.dataDe) params.set("dataDe", filters.dataDe);
  if (filters.dataAte) params.set("dataAte", filters.dataAte);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return query ? `/revisao/validacoes?${query}` : "/revisao/validacoes";
}

function visiblePages(page: number, pageCount: number) {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const candidates = new Set([1, 2, 3, page - 1, page, page + 1, pageCount]);
  return [...candidates]
    .filter((item) => item > 0 && item <= pageCount)
    .sort((a, b) => a - b);
}

const demoWorks = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Projeto Piloto" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Edifício Aurora" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Hospital Central" },
  { id: "00000000-0000-4000-8000-000000000004", name: "Viaduto Norte" },
];

function createDemoItems(
  works: ValidationMeta["works"],
): ValidationQueueItem[] {
  const availableWorks = works.length > 0 ? works : demoWorks;
  const suppliers = [
    "Construtora Silva Ltda.",
    "Transportes Ideal",
    "MegaParafusos",
    "Locação Equip. Sul",
    "Hidráulica Prime",
    "Ferragens Brasil",
    "Serviços Gerais Ltda.",
    "Concretos Certos",
    "Elétrica Forte Ltda.",
    "Luz & Cia Materiais",
  ];
  const findings = [
    "Divergência de quantidade entre a nota e a medição acumulada da obra.",
    "Item não previsto no contrato vigente da obra.",
    "Preço unitário acima da referência cadastrada.",
    "Valor total do cupom diferente do valor informado na nota.",
    "Data de emissão incompatível com o período de execução.",
  ];

  return Array.from({ length: 198 }, (_, index) => {
    const work = availableWorks[index % availableWorks.length];
    const day = 28 - (index % 6);
    const amount = 249200 - index * 913.47;
    return {
      classification: "Suspeita",
      date: `${String(day).padStart(2, "0")}/05/2024`,
      finding: findings[index % findings.length],
      id: `demo-validation-${String(index + 1).padStart(4, "0")}`,
      number: String(12589 - index).padStart(8, "0"),
      supplier: suppliers[index % suppliers.length],
      value: amount.toLocaleString("pt-BR", {
        currency: "BRL",
        style: "currency",
      }),
      work: work.name,
      workId: work.id,
    };
  });
}

function toIsoDate(value: string) {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

export function ReviewerValidationWorkspace({
  items,
  meta,
}: {
  items: ValidationQueueItem[];
  meta: ValidationMeta;
}) {
  const isDemo = meta.total === 0 && items.length === 0;
  const availableWorks = meta.works.length > 0 ? meta.works : demoWorks;
  const demoItems = useMemo(
    () => createDemoItems(availableWorks),
    [availableWorks],
  );
  const demoFiltered = useMemo(
    () =>
      demoItems.filter((item) => {
        const date = toIsoDate(item.date);
        return (
          (!meta.filters.obra || item.workId === meta.filters.obra) &&
          (!meta.filters.dataDe || date >= meta.filters.dataDe) &&
          (!meta.filters.dataAte || date <= meta.filters.dataAte)
        );
      }),
    [demoItems, meta.filters.dataAte, meta.filters.dataDe, meta.filters.obra],
  );
  const displayTotal = isDemo ? demoFiltered.length : meta.total;
  const displayPageCount = Math.max(1, Math.ceil(displayTotal / 10));
  const displayPage = Math.min(meta.page, displayPageCount);
  const suspiciousItems = useMemo(() => {
    if (isDemo) {
      const start = (displayPage - 1) * 10;
      return demoFiltered.slice(start, start + 10);
    }
    return items.filter((item) => item.classification === "Suspeita");
  }, [demoFiltered, displayPage, isDemo, items]);
  const [selectedId, setSelectedId] = useState<string | null>(
    suspiciousItems[0]?.id ?? null,
  );
  const [showFilters, setShowFilters] = useState(false);
  const selected =
    suspiciousItems.find((item) => item.id === selectedId) ??
    suspiciousItems[0];
  const pages = visiblePages(displayPage, displayPageCount);
  const rangeStart = displayTotal === 0 ? 0 : (displayPage - 1) * 10 + 1;
  const rangeEnd = Math.min(displayPage * 10, displayTotal);

  return (
    <PortalShell active="validacoes" role="reviewer">
      <PageIntro
        title="Validações"
        description="Revise e classifique as notas fiscais suspeitas que aguardam sua validação."
      />

      <section className={styles.layout}>
        <article className={styles.queuePanel}>
          <header className={styles.panelHeader}>
            <h2>
              Notas aguardando validação
              <span>{displayTotal}</span>
              {isDemo ? (
                <small className={styles.demoBadge}>Demonstração</small>
              ) : null}
            </h2>
            <button
              type="button"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((current) => !current)}
            >
              <Icon name="filter" /> Filtrar
              <Icon name="chevron" />
            </button>
          </header>

          {showFilters ? (
            <form className={styles.filters} method="get">
              <label>
                Obra
                <select name="obra" defaultValue={meta.filters.obra ?? ""}>
                  <option value="">Todas as obras</option>
                  {availableWorks.map((work) => (
                    <option key={work.id} value={work.id}>
                      {work.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data inicial
                <input
                  name="dataDe"
                  type="date"
                  defaultValue={meta.filters.dataDe ?? ""}
                />
              </label>
              <label>
                Data final
                <input
                  name="dataAte"
                  type="date"
                  defaultValue={meta.filters.dataAte ?? ""}
                />
              </label>
              <div className={styles.filterActions}>
                <Link href="/revisao/validacoes">Limpar</Link>
                <button type="submit">Aplicar filtros</button>
              </div>
            </form>
          ) : null}

          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Nº da nota</th>
                  <th>Valor</th>
                  <th>Emitida em</th>
                  <th>Classificação IA</th>
                  <th aria-label="Selecionar nota" />
                </tr>
              </thead>
              <tbody>
                {suspiciousItems.map((note, index) => (
                  <tr
                    key={note.id}
                    className={
                      note.id === selected?.id ? styles.selectedRow : undefined
                    }
                    onClick={() => setSelectedId(note.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.rowSelector}
                        onClick={() => setSelectedId(note.id)}
                      >
                        <span
                          className={
                            index % 3 === 0
                              ? styles.dangerIcon
                              : styles.warningIcon
                          }
                        >
                          <Icon name="warning" />
                        </span>
                        {note.supplier}
                      </button>
                    </td>
                    <td>{note.number}</td>
                    <td className={styles.money}>{note.value}</td>
                    <td>{note.date}</td>
                    <td>
                      <StatusBadge tone="warning">Suspeita</StatusBadge>
                    </td>
                    <td>
                      <Icon name="chevron" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {suspiciousItems.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name="check" />
              <strong>Nenhuma nota suspeita aguardando validação</strong>
              <p>A fila está em dia para os filtros selecionados.</p>
            </div>
          ) : null}

          <footer className={styles.pagination}>
            <span>
              {rangeStart}-{rangeEnd} de {displayTotal}
            </span>
            <nav aria-label="Paginação das validações">
              <Link
                aria-disabled={displayPage === 1}
                className={displayPage === 1 ? styles.disabledPage : undefined}
                href={pageHref(Math.max(1, displayPage - 1), meta.filters)}
              >
                ‹
              </Link>
              {pages.map((page, index) => (
                <span key={page} className={styles.pageSlot}>
                  {index > 0 && page - pages[index - 1] > 1 ? <i>…</i> : null}
                  <Link
                    className={
                      page === displayPage ? styles.activePage : undefined
                    }
                    href={pageHref(page, meta.filters)}
                  >
                    {page}
                  </Link>
                </span>
              ))}
              <Link
                aria-disabled={displayPage === displayPageCount}
                className={
                  displayPage === displayPageCount
                    ? styles.disabledPage
                    : undefined
                }
                href={pageHref(
                  Math.min(displayPageCount, displayPage + 1),
                  meta.filters,
                )}
              >
                ›
              </Link>
            </nav>
          </footer>
        </article>

        <article className={styles.detailPanel}>
          <header className={styles.panelHeader}>
            <h2>Detalhes da nota selecionada</h2>
            {selected ? (
              <Link
                className={styles.detailLink}
                href={`/notas/${selected.id}`}
              >
                Ir para nota detalhada <Icon name="chevron" />
              </Link>
            ) : null}
          </header>

          {selected ? (
            <div className={styles.detailBody}>
              <dl className={styles.summaryCard}>
                <span>
                  <Icon name="document" />
                </span>
                <div>
                  <dt>Fornecedor</dt>
                  <dd>{selected.supplier}</dd>
                </div>
                <div>
                  <dt>Nº da nota</dt>
                  <dd>{selected.number}</dd>
                </div>
                <div>
                  <dt>Valor</dt>
                  <dd className={styles.redValue}>{selected.value}</dd>
                </div>
                <div>
                  <dt>Emitida em</dt>
                  <dd>{selected.date}</dd>
                </div>
              </dl>

              <section className={styles.aiSummary}>
                <header>
                  <h3>Classificação sugerida pela IA</h3>
                  <StatusBadge tone="warning">Suspeita</StatusBadge>
                </header>
                <p>
                  <Icon name="sparkles" />
                  {selected.finding ??
                    "A IA identificou uma inconsistência que exige revisão humana antes da decisão final."}
                </p>
              </section>

              <ValidationDecisionForm key={selected.id} />
            </div>
          ) : (
            <div className={styles.detailEmpty}>
              <Icon name="document" />
              <strong>Selecione uma nota suspeita</strong>
              <p>O resumo e os controles de validação aparecerão aqui.</p>
            </div>
          )}
        </article>
      </section>
    </PortalShell>
  );
}

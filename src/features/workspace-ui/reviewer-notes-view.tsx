"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import { PortalShell, type PortalRole } from "./portal-shell";
import type { NoteFindingVisual, NoteVisualItem } from "./note-types";
import styles from "./reviewer-notes-view.module.css";

type ReviewerNotesViewProps = {
  items: NoteVisualItem[];
  role: PortalRole;
};

const statusClass: Record<string, string> = {
  "Em análise": styles.statusProcessing,
  OK: styles.statusOk,
  Suspeita: styles.statusSuspicious,
  "Sem parâmetro": styles.statusProcessing,
};

function statusLabel(item: NoteVisualItem) {
  return item.classification || "Em análise";
}

function findingFor(item: NoteVisualItem): NoteFindingVisual[] {
  if (item.findings && item.findings.length > 0) return item.findings;
  if (item.finding) {
    return [
      {
        description: "A IA registrou um achado que precisa ser acompanhado.",
        evidence: item.finding,
        justification:
          "O diagnóstico foi baseado nos dados extraídos deste anexo.",
        title: item.finding,
      },
    ];
  }
  return [];
}

function dateSortKey(value: string) {
  const parts = value.split("/");
  if (parts.length !== 3) return 0;
  return new Date(
    Number(parts[2]),
    Number(parts[1]) - 1,
    Number(parts[0]),
  ).getTime();
}

function dateInputKey(value: string) {
  const parts = value.split("/");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
}

export function ReviewerNotesView({ items, role }: ReviewerNotesViewProps) {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  const periods = useMemo(() => {
    const unique = new Set(
      items.map((item) => {
        const parts = item.date.split("/");
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : "";
      }),
    );
    return [...unique]
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => {
        const [month, year] = value.split("/").map(Number);
        const label = new Intl.DateTimeFormat("pt-BR", {
          month: "long",
          year: "numeric",
        }).format(new Date(year, month - 1, 1));
        return { label: label.charAt(0).toUpperCase() + label.slice(1), value };
      });
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      const parts = item.date.split("/");
      const itemPeriod = parts.length === 3 ? `${parts[1]}/${parts[2]}` : "";
      const itemDate = dateInputKey(item.date);
      const matchesQuery =
        !normalizedQuery ||
        item.number.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        item.supplier.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      const hasCustomRange = Boolean(dateFrom || dateTo);
      return (
        matchesQuery &&
        (hasCustomRange || !period || period === itemPeriod) &&
        (!dateFrom || (itemDate && itemDate >= dateFrom)) &&
        (!dateTo || (itemDate && itemDate <= dateTo)) &&
        (!status || status === statusLabel(item))
      );
    });
  }, [dateFrom, dateTo, items, period, query, status]);

  const visibleItems = useMemo(
    () => filteredItems.filter((item) => !readIds.has(item.id)),
    [filteredItems, readIds],
  );

  const selected =
    visibleItems.find((item) => item.id === selectedId) ??
    visibleItems[0] ??
    null;
  const selectedFindings = selected ? findingFor(selected) : [];
  const isRead = selected ? readIds.has(selected.id) : false;

  function selectItem(id: string) {
    setSelectedId(id);
  }

  function markAsRead() {
    if (!selected) return;
    setReadIds((current) => {
      const next = new Set(current);
      next.add(selected.id);
      return next;
    });
    setSelectedId(null);
  }

  return (
    <PortalShell active="notas" role={role}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>REVISÃO DE ANEXOS</p>
            <h1>Notas</h1>
            <p className={styles.subtitle}>
              Acompanhe os anexos recebidos e o diagnóstico da IA.
            </p>
          </div>
          <div className={styles.headerStats} aria-label="Resumo das notas">
            <span>
              <strong>{visibleItems.length}</strong> anexos
            </span>
            <span className={styles.statDot} />
            <span>
              <strong>
                {visibleItems.filter((item) => statusLabel(item) === "Suspeita").length}
              </strong>{" "}
              suspeitos
            </span>
          </div>
        </header>

        <section className={styles.filters} aria-label="Filtros de notas">
          <label className={styles.searchField}>
            <Icon name="search" />
            <span className={styles.visuallyHidden}>Buscar anexo</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por número da nota ou fornecedor"
            />
          </label>
          <label className={styles.selectField}>
            <Icon name="calendar" />
            <span className={styles.visuallyHidden}>Período</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="">Todos os meses</option>
              {periods.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.selectField}>
            <Icon name="filter" />
            <span className={styles.visuallyHidden}>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos os status</option>
              <option value="Suspeita">Suspeitas</option>
              <option value="OK">OK</option>
              <option value="Em análise">Em análise</option>
              </select>
          </label>
          <label className={styles.dateField}>
            <Icon name="calendar" />
            <span className={styles.visuallyHidden}>Data inicial</span>
            <input
              aria-label="Data inicial"
              onChange={(event) => setDateFrom(event.target.value)}
              type="date"
              value={dateFrom}
            />
          </label>
          <label className={styles.dateField}>
            <Icon name="calendar" />
            <span className={styles.visuallyHidden}>Data final</span>
            <input
              aria-label="Data final"
              onChange={(event) => setDateTo(event.target.value)}
              type="date"
              value={dateTo}
            />
          </label>
          {(query || period || status || dateFrom || dateTo) && (
            <button
              className={styles.clearButton}
              type="button"
              onClick={() => {
                setQuery("");
                setPeriod("");
                setStatus("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Limpar
            </button>
          )}
        </section>

        <div className={styles.workspaceGrid}>
          <section className={styles.attachmentsPanel} aria-labelledby="attachments-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="attachments-title">Anexos recebidos</h2>
                <p>{visibleItems.length} itens para acompanhar</p>
              </div>
              <span className={styles.countPill}>{visibleItems.length}</span>
            </div>
            <div className={styles.attachmentList}>
              {visibleItems.length === 0 ? (
                <div className={styles.emptyState}>
                  <Icon name="document" />
                  <strong>Nenhum anexo encontrado</strong>
                  <span>Ajuste a busca ou os filtros para continuar.</span>
                </div>
              ) : (
                visibleItems
                  .slice()
                  .sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date))
                  .map((item) => {
                    const itemStatus = statusLabel(item);
                    const itemRead = readIds.has(item.id);
                    return (
                      <button
                        className={`${styles.attachmentRow} ${
                          selected?.id === item.id ? styles.attachmentSelected : ""
                        }`}
                        key={item.id}
                        onClick={() => selectItem(item.id)}
                        type="button"
                      >
                        <span className={`${styles.attachmentIcon} ${statusClass[itemStatus] ?? styles.statusProcessing}`}>
                          <Icon name="document" />
                        </span>
                        <span className={styles.attachmentCopy}>
                          <strong>{item.number}</strong>
                          <span>{item.supplier}</span>
                          <small>
                            {item.date}
                            {item.work ? ` • ${item.work}` : ""}
                          </small>
                        </span>
                        <span className={styles.attachmentMeta}>
                          <strong>{item.value}</strong>
                          <span className={`${styles.statusBadge} ${statusClass[itemStatus] ?? styles.statusProcessing}`}>
                            {itemStatus}
                          </span>
                          <span className={`${styles.readDot} ${itemRead ? styles.readDotRead : ""}`} aria-label={itemRead ? "Lida" : "Não lida"} />
                        </span>
                      </button>
                    );
                  })
              )}
            </div>
            <footer className={styles.panelFooter}>
              <span>Unidade de acompanhamento: 1 anexo</span>
              <span>Atualização automática</span>
            </footer>
          </section>

          <section className={styles.diagnosisPanel} aria-labelledby="diagnosis-title">
            {selected ? (
              <>
                <div className={styles.selectedHeader}>
                  <div className={styles.selectedTitle}>
                    <span className={`${styles.selectedIcon} ${statusClass[statusLabel(selected)] ?? styles.statusProcessing}`}>
                      <Icon name="document" />
                    </span>
                    <div>
                      <p className={styles.kicker}>Anexo selecionado</p>
                      <h2>{selected.number}</h2>
                      <p>{selected.supplier}</p>
                    </div>
                  </div>
                  <span className={`${styles.largeStatus} ${statusClass[statusLabel(selected)] ?? styles.statusProcessing}`}>
                    {statusLabel(selected)}
                  </span>
                </div>

                <div className={styles.diagnosisHeading}>
                  <div>
                    <p className={styles.kicker}>LEITURA DA NOTA</p>
                    <h2 id="diagnosis-title">Diagnóstico da IA</h2>
                    <p>
                      Evidências encontradas no processamento deste anexo.
                    </p>
                  </div>
                  <span className={styles.findingCount}>
                    {selectedFindings.length} {selectedFindings.length === 1 ? "achado" : "achados"}
                  </span>
                </div>

                {selectedFindings.length > 0 ? (
                  <div className={styles.findingsList}>
                    {selectedFindings.map((finding, index) => (
                      <article className={styles.findingCard} key={`${finding.title}-${index}`}>
                        <div className={styles.findingTopline}>
                          <span className={styles.findingNumber}>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <h3>{finding.title}</h3>
                            {finding.category || finding.severity ? (
                              <span className={styles.findingMeta}>
                                {finding.category ?? "Auditoria"}
                                {finding.severity ? ` • ${finding.severity.toLowerCase()}` : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className={styles.findingDescription}>{finding.description}</p>
                        {finding.evidence ? (
                          <div className={styles.evidenceBlock}>
                            <span>Evidência</span>
                            <p>{finding.evidence}</p>
                          </div>
                        ) : null}
                        {finding.expectedValue || finding.actualValue ? (
                          <div className={styles.comparisonGrid}>
                            {finding.expectedValue ? (
                              <div>
                                <span>Esperado</span>
                                <strong>{finding.expectedValue}</strong>
                              </div>
                            ) : null}
                            {finding.actualValue ? (
                              <div>
                                <span>Encontrado</span>
                                <strong>{finding.actualValue}</strong>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {finding.justification ? (
                          <div className={styles.justificationBlock}>
                            <span>Justificativa</span>
                            <p>{finding.justification}</p>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.noFinding}>
                    <span className={styles.noFindingIcon}><Icon name="check" /></span>
                    <div>
                      <strong>Nenhuma inconsistência registrada</strong>
                      <p>A IA não encontrou um achado para este anexo.</p>
                    </div>
                  </div>
                )}

                <details className={styles.extractedDetails}>
                  <summary>
                    <span><Icon name="document" /> Dados extraídos</span>
                    <span className={styles.summaryHint}>Ver resumo <Icon name="chevron" /></span>
                  </summary>
                  <div className={styles.extractedContent}>
                    <span><strong>Fornecedor</strong>{selected.supplier}</span>
                    <span><strong>Data de emissão</strong>{selected.date}</span>
                    <span><strong>Valor total</strong>{selected.value}</span>
                    {selected.work ? <span><strong>Obra</strong>{selected.work}</span> : null}
                  </div>
                </details>

                <div className={styles.diagnosisActions}>
                  <Link className={styles.detailLink} href={`/notas/${selected.id}`}>
                    Ver nota detalhada <Icon name="chevron" />
                  </Link>
                  <button
                    className={`${styles.readButton} ${isRead ? styles.readButtonDone : ""}`}
                    disabled={isRead}
                    onClick={markAsRead}
                    type="button"
                  >
                    <Icon name={isRead ? "check" : "check"} />
                    {isRead ? "Marcada como lida" : "Marcar como lida"}
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.emptyDiagnosis}>
                <Icon name="document" />
                <h2>Selecione um anexo</h2>
                <p>Escolha um item à esquerda para ver o diagnóstico da IA.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </PortalShell>
  );
}

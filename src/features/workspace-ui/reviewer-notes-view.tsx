"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { sanitizeReviewerText } from "@/features/note-detail/data/reviewer-data-policy";

import { Icon } from "./ui-icons";
import { PortalShell, type PortalRole } from "./portal-shell";
import type { NoteFindingVisual, NoteVisualItem } from "./note-types";
import styles from "./reviewer-notes-view.module.css";

type ReviewerNotesViewProps = {
  initialQuery?: string;
  items: NoteVisualItem[];
  page?: number;
  pageCount?: number;
  role: PortalRole;
  total?: number;
};

const statusClass: Record<string, string> = {
  "Aguardando processamento": styles.statusProcessing,
  "Em análise": styles.statusProcessing,
  "Falha de processamento": styles.statusFailed,
  "Falha de leitura": styles.statusFailed,
  "Não processado": styles.statusProcessing,
  OK: styles.statusOk,
  "Precisa de informação": styles.statusNeedsContext,
  Suspeita: styles.statusSuspicious,
};

function statusLabel(item: NoteVisualItem) {
  const classification = item.classification?.trim();

  if (
    classification === "NEEDS_CONTEXT" ||
    classification === "NO_PARAMETER" ||
    classification === "Sem parâmetro"
  ) {
    return "Precisa de informação";
  }

  return classification || "Em análise";
}

function statusIcon(status: string): "help" | "document" {
  return status === "Precisa de informação" ? "help" : "document";
}

function unavailableDiagnosisCopy(status: string | null) {
  if (status === "Aguardando processamento" || status === "Em análise") {
    return {
      description:
        "O anexo ainda está na fila de análise. O diagnóstico será exibido quando o processamento terminar.",
      title: "Análise ainda não concluída",
    };
  }

  if (status === "Não processado") {
    return {
      description:
        "Este anexo antigo não possui uma execução de processamento associada.",
      title: "Análise não iniciada",
    };
  }

  if (status === "Falha de leitura") {
    return {
      description:
        "Não foi possível obter dados confiáveis do arquivo para gerar um diagnóstico.",
      title: "Não foi possível ler o anexo",
    };
  }

  if (status === "Falha de processamento") {
    return {
      description:
        "A leitura foi iniciada, mas o processamento não chegou a um diagnóstico final.",
      title: "O processamento não foi concluído",
    };
  }

  return null;
}

function findingFor(item: NoteVisualItem): NoteFindingVisual[] {
  if (item.findings && item.findings.length > 0) {
    return item.findings.map((finding) => ({
      ...finding,
      actualValue: finding.actualValue
        ? sanitizeReviewerText(finding.actualValue)
        : finding.actualValue,
      description: sanitizeReviewerText(finding.description),
      evidence: finding.evidence
        ? sanitizeReviewerText(finding.evidence)
        : finding.evidence,
      expectedValue: finding.expectedValue
        ? sanitizeReviewerText(finding.expectedValue)
        : finding.expectedValue,
      justification: finding.justification
        ? sanitizeReviewerText(finding.justification)
        : finding.justification,
      title: sanitizeReviewerText(finding.title),
    }));
  }
  if (item.finding) {
    const safeFinding = sanitizeReviewerText(item.finding);
    return [
      {
        description: "A IA registrou um achado que precisa ser acompanhado.",
        evidence: safeFinding,
        justification:
          "O diagnóstico foi baseado nos dados extraídos deste anexo.",
        title: safeFinding,
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

function currentPeriodValue() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

export function ReviewerNotesView({
  initialQuery = "",
  items,
  page = 1,
  pageCount = 1,
  role,
  total = items.length,
}: ReviewerNotesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const currentPeriod = useMemo(() => currentPeriodValue(), []);
  const [query, setQuery] = useState(initialQuery);
  const [period, setPeriod] = useState(currentPeriod);
  const [status, setStatus] = useState("");
  const [responsible, setResponsible] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(items.filter((item) => item.isRead).map((item) => item.id)),
  );
  const [readError, setReadError] = useState<string | null>(null);
  const [readNotice, setReadNotice] = useState<string | null>(null);

  const periods = useMemo(() => {
    const unique = new Set(
      [currentPeriod, ...items.map((item) => {
        const parts = item.date.split("/");
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : "";
      })],
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
  }, [currentPeriod, items]);

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
        (!responsible || item.responsible === responsible) &&
        (!status || status === statusLabel(item))
      );
    });
  }, [dateFrom, dateTo, items, period, query, responsible, status]);

  const responsibles = useMemo(
    () =>
      [...new Set(items.map((item) => item.responsible).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [items],
  );

  const visibleItems = useMemo(
    () => filteredItems.filter((item) => !readIds.has(item.id)),
    [filteredItems, readIds],
  );
  const hasLocalFilter = Boolean(
    query.trim() || period || status || responsible || dateFrom || dateTo || readIds.size,
  );
  const displayedTotal = hasLocalFilter ? visibleItems.length : total;
  const displayedPage = hasLocalFilter ? 1 : page;
  const displayedPageCount = hasLocalFilter ? 1 : pageCount;

  const selected =
    visibleItems.find((item) => item.id === selectedId) ??
    visibleItems[0] ??
    null;
  const selectedFindings = selected ? findingFor(selected) : [];
  const isRead = selected ? readIds.has(selected.id) : false;
  const selectedStatus = selected ? statusLabel(selected) : null;
  const selectedNeedsContext = selectedStatus === "Precisa de informação";
  const unavailableDiagnosis = unavailableDiagnosisCopy(selectedStatus);
  const canMarkRead =
    selectedStatus !== "Aguardando processamento" &&
    selectedStatus !== "Em análise";

  function selectItem(id: string) {
    setReadNotice(null);
    setSelectedId(id);
  }

  async function markAsRead() {
    if (!selected || !canMarkRead) return;
    setReadError(null);
    try {
      const response = await fetch(`/api/notas/${selected.id}/read`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error();
      const nextSelected = visibleItems.find((item) => item.id !== selected.id);
      setReadIds((current) => {
        const next = new Set(current);
        next.add(selected.id);
        return next;
      });
      setSelectedId(nextSelected?.id ?? null);
      setReadNotice("Anexo marcado como lido e removido da lista.");
    } catch {
      setReadError("Não foi possível marcar este anexo como lido.");
    }
  }

  function goToPage(nextPage: number) {
    if (nextPage < 1 || nextPage > pageCount || nextPage === page) return;
    const params = new URLSearchParams(window.location.search);
    if (nextPage === 1) params.delete("pagina");
    else params.set("pagina", String(nextPage));
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
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
          <div className={styles.headerStats} aria-label="Resumo dos anexos">
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

        <section className={styles.filters} aria-label="Filtros de anexos">
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
              <option value="Precisa de informação">Precisa de informação</option>
              <option value="Falha de leitura">Falha de leitura</option>
              <option value="Falha de processamento">Falha de processamento</option>
              <option value="Não processado">Não processado</option>
              <option value="Aguardando processamento">Aguardando processamento</option>
              <option value="Em análise">Em análise</option>
            </select>
          </label>
          <label className={styles.selectField}>
            <Icon name="building" />
            <span className={styles.visuallyHidden}>Responsável</span>
            <select
              aria-label="Responsável"
              value={responsible}
              onChange={(event) => setResponsible(event.target.value)}
            >
              <option value="">Todos os responsáveis</option>
              {responsibles.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
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
          {(query || period || status || responsible || dateFrom || dateTo) && (
            <button
              className={styles.clearButton}
              type="button"
              onClick={() => {
                setQuery("");
                setPeriod("");
                setStatus("");
                setResponsible("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Limpar
            </button>
          )}
        </section>

        {readNotice ? (
          <p className={styles.readNotice} role="status" aria-live="polite">
            <Icon name="check" />
            {readNotice}
          </p>
        ) : null}

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
                          <Icon name={statusIcon(itemStatus)} />
                        </span>
                        <span className={styles.attachmentCopy}>
                          <strong>{item.number}</strong>
                          <span>{item.supplier}</span>
                          <small>
                            {item.date}
                            {item.work ? ` • ${item.work}` : ""}
                          </small>
                          <span className={`${styles.mobileStatus} ${statusClass[itemStatus] ?? styles.statusProcessing}`}>
                            {itemStatus === "Precisa de informação" ? <Icon name="help" /> : null}
                            {itemStatus}
                          </span>
                        </span>
                        <span className={styles.attachmentMeta}>
                          <strong>{item.value}</strong>
                          <span className={`${styles.statusBadge} ${statusClass[itemStatus] ?? styles.statusProcessing}`}>
                            {itemStatus === "Precisa de informação" ? <Icon name="help" /> : null}
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
              <span>
                {displayedTotal === 0
                  ? "Nenhum anexo"
                  : `Página ${displayedPage} de ${displayedPageCount} • ${displayedTotal} anexos`}
              </span>
              <span className={styles.pagination}>
                <button
                  aria-label="Página anterior"
                  disabled={hasLocalFilter || page <= 1}
                  onClick={() => goToPage(page - 1)}
                  type="button"
                >
                  ‹
                </button>
                <strong>{displayedPage}</strong>
                <button
                  aria-label="Próxima página"
                  disabled={hasLocalFilter || page >= pageCount}
                  onClick={() => goToPage(page + 1)}
                  type="button"
                >
                  ›
                </button>
              </span>
            </footer>
          </section>

          <section className={styles.diagnosisPanel} aria-labelledby="diagnosis-title">
            {selected ? (
              <>
                <div className={styles.selectedHeader}>
                  <div className={styles.selectedTitle}>
                    <span className={`${styles.selectedIcon} ${statusClass[statusLabel(selected)] ?? styles.statusProcessing}`}>
                      <Icon name={statusIcon(statusLabel(selected))} />
                    </span>
                    <div>
                      <p className={styles.kicker}>Anexo selecionado</p>
                      <h2>{selected.number}</h2>
                      <p>{selected.supplier}</p>
                    </div>
                  </div>
                  <span className={`${styles.largeStatus} ${statusClass[statusLabel(selected)] ?? styles.statusProcessing}`}>
                    {selectedNeedsContext ? <Icon name="help" /> : null}
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
                  {selectedNeedsContext ? (
                    <span className={styles.contextCount}>
                      <Icon name="help" /> Informação necessária
                    </span>
                  ) : unavailableDiagnosis ? (
                    <span className={styles.contextCount}>{selectedStatus}</span>
                  ) : (
                    <span className={styles.findingCount}>
                      {selectedFindings.length} {selectedFindings.length === 1 ? "achado" : "achados"}
                    </span>
                  )}
                </div>

                {selectedNeedsContext ? (
                  <div className={styles.contextSummary}>
                    <span className={styles.contextSummaryIcon}><Icon name="help" /></span>
                    <div>
                      <strong>Falta contexto para concluir a análise</strong>
                      <p>
                        O anexo foi lido, mas as informações disponíveis ainda não permitem
                        que a IA determine um diagnóstico final.
                      </p>
                    </div>
                  </div>
                ) : unavailableDiagnosis ? (
                  <div className={styles.contextSummary}>
                    <span className={styles.contextSummaryIcon}>
                      <Icon name="document" />
                    </span>
                    <div>
                      <strong>{unavailableDiagnosis.title}</strong>
                      <p>{unavailableDiagnosis.description}</p>
                    </div>
                  </div>
                ) : selectedFindings.length > 0 ? (
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
                    disabled={isRead || !canMarkRead}
                    onClick={markAsRead}
                    type="button"
                  >
                    <Icon name={isRead ? "check" : "check"} />
                    {isRead
                      ? "Marcada como lida"
                      : canMarkRead
                        ? "Marcar como lida"
                        : "Aguardando análise"}
                  </button>
                </div>
                {readError ? <p className={styles.readError}>{readError}</p> : null}
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

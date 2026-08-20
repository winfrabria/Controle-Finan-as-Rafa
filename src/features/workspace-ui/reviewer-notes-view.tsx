"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";

import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";
import { sanitizeReviewerText } from "@/features/note-detail/data/reviewer-data-policy";
import {
  compactFindingFieldPath,
  formatFindingValueLines,
  humanizeFindingText,
} from "@/features/internal-notes/finding-display";

import { Icon } from "./ui-icons";
import { PortalShell, type PortalRole } from "./portal-shell";
import { filterReviewerNoteRows } from "./reviewer-note-filters";
import type { NoteFindingVisual, NoteVisualItem } from "./note-types";
import { ReviewerMobileNotesList } from "./reviewer-mobile-notes-list";
import styles from "./reviewer-notes-view.module.css";

type ReviewerNotesViewProps = {
  embedded?: boolean;
  initialQuery?: string;
  initialSelectedId?: string;
  items: NoteVisualItem[];
  page?: number;
  pageCount?: number;
  role: PortalRole;
  mode?: "history" | "inbox";
  total?: number;
};

const statusClass: Record<string, string> = {
  "Análise incompleta": styles.statusIncomplete,
  "Aguardando processamento": styles.statusProcessing,
  "Em análise": styles.statusProcessing,
  "Falha de processamento": styles.statusFailed,
  "Falha de leitura": styles.statusFailed,
  "Informação insuficiente": styles.statusNeedsContext,
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
    return item.activeContextQuestionCount && item.activeContextQuestionCount > 0
      ? "Precisa de informação"
      : "Análise incompleta";
  }

  return classification || "Em análise";
}

function statusIcon(status: string): "help" | "document" {
  return status === "Precisa de informação" ||
    status === "Informação insuficiente" ||
    status === "Análise incompleta"
    ? "help"
    : "document";
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

  if (status === "Análise incompleta") {
    return {
      description:
        "O processamento terminou sem evidências estruturadas suficientes para sustentar um diagnóstico. O anexo precisa ser reprocessado pelo administrador.",
      title: "Diagnóstico precisa ser reprocessado",
    };
  }

  if (status === "Informação insuficiente") {
    return {
      description:
        "O arquivo foi lido, mas o contexto disponível não permite uma conclusão confiável.",
      title: "Informação insuficiente para concluir",
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
      evidenceDetails: finding.evidenceDetails?.map((part) => ({
        label: sanitizeReviewerText(part.label),
        value: sanitizeReviewerText(part.value),
      })),
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

function currentPeriodValue() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

function itemDate(item: NoteVisualItem, historyMode: boolean) {
  if (!historyMode || !item.readAt) return item.date;
  const value = new Date(item.readAt);
  if (Number.isNaN(value.getTime())) return item.date;
  return new Intl.DateTimeFormat("pt-BR").format(value);
}

function findingCategoryLabel(value?: string | null) {
  if (!value) return "Auditoria da IA";
  const labels: Record<string, string> = {
    ALCOHOL: "Bebida alcoólica",
    BUDGET: "Limite da obra",
    CNPJ: "Cadastro do fornecedor",
    CONSISTENCY: "Conferência de valores",
    DATE: "Data do documento",
    DOCUMENT_TYPE: "Tipo de documento",
    DUPLICATE: "Possível duplicidade",
    EXTRACTION: "Leitura do documento",
    FORMAT: "Formato do documento",
    INCONSISTENCY: "Inconsistência",
    OTHER: "Outra inconsistência",
    PERSONAL_HYGIENE: "Higiene pessoal",
    PRICE: "Preço",
    QUANTITY_TIMES_PRICE: "Quantidade e preço",
    TOTALS: "Totais do documento",
  };
  const normalized = value.trim().toUpperCase();
  if (labels[normalized]) return labels[normalized];
  return value
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function severityLabel(value?: string | null) {
  const labels: Record<string, string> = {
    CRITICAL: "Crítica",
    HIGH: "Alta",
    INFO: "Informativa",
    LOW: "Baixa",
    MEDIUM: "Média",
    WARNING: "Atenção",
  };
  return value ? labels[value.toUpperCase()] ?? findingCategoryLabel(value) : null;
}

function isInformationalFinding(finding: NoteFindingVisual) {
  return finding.severity?.toUpperCase() === "INFO";
}

function compactEvidenceDetails(finding: NoteFindingVisual) {
  return (finding.evidenceDetails ?? [])
    .filter((part) => {
      const normalizedValue = part.value.trim().toLocaleLowerCase("pt-BR");
      if (!normalizedValue || normalizedValue === "—") return false;
      if (part.label === "Fonte") return false;
      if (part.label === "Resumo da evidência" || part.label === "Evidência") return false;
      return true;
    })
    .slice(0, 2)
    .map((part) => ({
      ...part,
      value: compactEvidenceValue(part.label, part.value),
    }));
}

function compactEvidenceValue(label: string, value: string) {
  return label === "Campo" ? compactFindingFieldPath(value) : value;
}

function compactFindingDescription(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 135) return text;
  const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= 155) return firstSentence;
  return `${text.slice(0, 132).trimEnd()}…`;
}

export function ReviewerNotesView({
  embedded = false,
  initialQuery = "",
  initialSelectedId,
  items,
  page = 1,
  pageCount = 1,
  role,
  mode = "inbox",
  total = items.length,
}: ReviewerNotesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const historyMode = mode === "history";
  const adminHistory = historyMode && role === "admin";
  const useReadHistoryDates = historyMode && !adminHistory;
  const currentPeriod = useMemo(() => currentPeriodValue(), []);
  const [query, setQuery] = useState(initialQuery);
  const [period, setPeriod] = useState(historyMode ? "" : currentPeriod);
  const [status, setStatus] = useState("");
  const [responsible, setResponsible] = useState("");
  const [work, setWork] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && items.some((item) => item.id === initialSelectedId)
      ? initialSelectedId
      : items[0]?.id ?? null,
  );
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(items.filter((item) => item.isRead).map((item) => item.id)),
  );
  const [readError, setReadError] = useState<string | null>(null);
  const [readNotice, setReadNotice] = useState<string | null>(null);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const periods = useMemo(() => {
    const unique = new Set(
      [currentPeriod, ...items.map((item) => {
        const parts = itemDate(item, useReadHistoryDates).split("/");
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : "";
      })],
    );
    return [...unique]
      .filter(Boolean)
      .sort((a, b) => {
        const [monthA, yearA] = a.split("/").map(Number);
        const [monthB, yearB] = b.split("/").map(Number);
        return yearB * 12 + monthB - (yearA * 12 + monthA);
      })
      .map((value) => {
        const [month, year] = value.split("/").map(Number);
        const label = new Intl.DateTimeFormat("pt-BR", {
          month: "long",
          year: "numeric",
        }).format(new Date(year, month - 1, 1));
        return { label: label.charAt(0).toUpperCase() + label.slice(1), value };
      });
  }, [currentPeriod, items, useReadHistoryDates]);

  const filteredItems = useMemo(() => {
    return filterReviewerNoteRows(
      items.map((item) => ({
        displayDate: itemDate(item, useReadHistoryDates),
        item,
        status: statusLabel(item),
      })),
      { dateFrom, dateTo, period, query, responsible, status, work },
    ).map((row) => row.item);
  }, [dateFrom, dateTo, items, period, query, responsible, status, useReadHistoryDates, work]);

  const responsibles = useMemo(
    () =>
      [...new Set(items.map((item) => item.responsible).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [items],
  );

  const works = useMemo(
    () =>
      [...new Set(items.map((item) => item.work).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [items],
  );

  const visibleItems = useMemo(
    () => historyMode ? filteredItems : filteredItems.filter((item) => !readIds.has(item.id)),
    [filteredItems, historyMode, readIds],
  );
  const hasLocalFilter = Boolean(
    query.trim() || period || status || responsible || work || dateFrom || dateTo || (!historyMode && readIds.size),
  );
  const displayedTotal = hasLocalFilter ? visibleItems.length : total;
  const displayedPage = hasLocalFilter ? 1 : page;
  const displayedPageCount = hasLocalFilter ? 1 : pageCount;
  const secondaryStatCount = historyMode
    ? adminHistory
      ? visibleItems.filter((item) => statusLabel(item) === "Suspeita").length
      : visibleItems.filter((item) => Boolean(item.readAt)).length
    : visibleItems.filter((item) => statusLabel(item) === "Suspeita").length;

  const selected =
    visibleItems.find((item) => item.id === selectedId) ??
    visibleItems[0] ??
    null;
  const selectedFindings = selected ? findingFor(selected) : [];
  const actionableFindings = selectedFindings.filter(
    (finding) => !isInformationalFinding(finding),
  );
  const informationalFindings = selectedFindings.filter(isInformationalFinding);
  const previewFindings = actionableFindings;
  const totalFindingCount = Math.max(
    actionableFindings.length,
    selected?.findingCount ?? 0,
  );
  const hiddenFindingCount = Math.max(0, totalFindingCount - previewFindings.length);
  const isRead = selected ? readIds.has(selected.id) : false;
  const selectedStatus = selected ? statusLabel(selected) : null;
  const selectedNeedsContext = selectedStatus === "Precisa de informação";
  const unavailableDiagnosis = unavailableDiagnosisCopy(selectedStatus);
  const canMarkRead =
    selectedStatus !== "Aguardando processamento" &&
    selectedStatus !== "Em análise" &&
    selectedStatus !== "Precisa de informação" &&
    selectedStatus !== "Análise incompleta";

  function selectItem(id: string) {
    setReadNotice(null);
    setSelectedId(id);
  }

  async function markAsRead() {
    if (!selected || !canMarkRead || isMarkingRead) return;
    const endCriticalActivity = beginPwaCriticalActivity();
    setReadError(null);
    setIsMarkingRead(true);
    try {
      const response = await fetch(`/api/notas/${selected.id}/read`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { erro?: { mensagem?: string } }
          | null;
        throw new Error(
          payload?.erro?.mensagem ?? "Não foi possível marcar este anexo como lido.",
        );
      }
      const nextSelected = visibleItems.find((item) => item.id !== selected.id);
      setReadIds((current) => {
        const next = new Set(current);
        next.add(selected.id);
        return next;
      });
      setSelectedId(nextSelected?.id ?? null);
      setReadNotice("Anexo marcado como lido e removido da lista.");
    } catch (caught) {
      setReadError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível marcar este anexo como lido.",
      );
    } finally {
      setIsMarkingRead(false);
      endCriticalActivity();
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

  const Shell = embedded ? EmbeddedShell : PortalShell;

  return (
    <Shell active={historyMode ? "historico" : "notas"} role={role}>
      <div className={`${styles.page} ${historyMode ? styles.historyPage : ""} ${role === "reviewer" ? styles.reviewerPage : ""}`}>
        {role === "reviewer" ? (
          <ReviewerMobileNotesList items={items} mode={mode} />
        ) : null}
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>{historyMode ? adminHistory ? "HISTÓRICO OPERACIONAL" : "ANEXOS ACOMPANHADOS" : "REVISÃO DE ANEXOS"}</p>
            <h1>{historyMode ? "Histórico" : "Notas"}</h1>
            <p className={styles.subtitle}>
              {historyMode
                ? adminHistory
                  ? "Consulte todos os anexos com processamento concluído, inclusive falhas e suspeitas."
                  : "Consulte tudo o que já foi marcado como lido."
                : "Acompanhe os anexos recebidos e o diagnóstico da IA."}
            </p>
          </div>
          <div className={styles.headerStats} aria-label="Resumo dos anexos">
            <span>
              <strong>{visibleItems.length}</strong>{" "}
              {visibleItems.length === 1 ? "anexo" : "anexos"}
            </span>
            <span className={styles.statDot} />
            <span>
              <strong>{secondaryStatCount}</strong>{" "}
              {historyMode
                ? adminHistory
                  ? secondaryStatCount === 1
                    ? "suspeito"
                    : "suspeitos"
                  : secondaryStatCount === 1
                    ? "lido"
                    : "lidos"
                : secondaryStatCount === 1
                  ? "suspeito"
                  : "suspeitos"}
            </span>
          </div>
        </header>

        <section
          className={styles.filters}
          aria-label="Filtros de anexos"
          data-mobile-open={filtersOpen}
          id="note-secondary-filters"
        >
          <label className={styles.searchField}>
            <Icon name="search" />
            <span className={styles.visuallyHidden}>Buscar anexo</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={adminHistory ? "Buscar por número, fornecedor ou conteúdo" : "Buscar por número da nota ou fornecedor"}
            />
          </label>
          <button
            aria-controls="note-secondary-filters"
            aria-expanded={filtersOpen}
            className={styles.mobileFilterToggle}
            onClick={() => setFiltersOpen((current) => !current)}
            type="button"
          >
            <Icon name="filter" />
            {filtersOpen ? "Ocultar filtros" : "Filtros"}
            {period || status || responsible || work || dateFrom || dateTo ? (
              <span aria-label="Filtros ativos">●</span>
            ) : null}
          </button>
          <label className={`${styles.selectField} ${styles.filterSecondary}`}>
            <Icon name="calendar" />
            <span className={styles.visuallyHidden}>Período</span>
            <select
              aria-label="Período"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                setDateFrom("");
                setDateTo("");
              }}
            >
              <option value="">Todos os meses</option>
              {periods.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {historyMode ? (
            <label className={`${styles.selectField} ${styles.filterSecondary}`}>
              <Icon name="building" />
              <span className={styles.visuallyHidden}>Obra</span>
              <select
                aria-label="Obra"
                value={work}
                onChange={(event) => setWork(event.target.value)}
              >
                <option value="">Todas as obras</option>
                {works.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className={`${styles.selectField} ${styles.filterSecondary}`}>
            <Icon name="filter" />
            <span className={styles.visuallyHidden}>Status</span>
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="Suspeita">Suspeitas</option>
              <option value="OK">OK</option>
              <option value="Precisa de informação">Precisa de informação</option>
              <option value="Informação insuficiente">Informação insuficiente</option>
              <option value="Análise incompleta">Análise incompleta</option>
              <option value="Falha de leitura">Falha de leitura</option>
              <option value="Falha de processamento">Falha de processamento</option>
              <option value="Não processado">Não processado</option>
              <option value="Aguardando processamento">Aguardando processamento</option>
              <option value="Em análise">Em análise</option>
            </select>
          </label>
          <label className={`${styles.selectField} ${styles.filterSecondary}`}>
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
          <label className={`${styles.dateField} ${styles.filterSecondary}`}>
            <Icon name="calendar" />
            <span className={styles.visuallyHidden}>Data inicial</span>
            <input
              aria-label="Data inicial"
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPeriod("");
              }}
              type="date"
              value={dateFrom}
            />
          </label>
          <label className={`${styles.dateField} ${styles.filterSecondary}`}>
            <Icon name="calendar" />
            <span className={styles.visuallyHidden}>Data final</span>
            <input
              aria-label="Data final"
              onChange={(event) => {
                setDateTo(event.target.value);
                setPeriod("");
              }}
              type="date"
              value={dateTo}
            />
          </label>
          {(query || period || status || responsible || work || dateFrom || dateTo) && (
            <button
              className={`${styles.clearButton} ${styles.filterSecondary}`}
              type="button"
              onClick={() => {
                setQuery("");
                setPeriod("");
                setStatus("");
                setResponsible("");
                setWork("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Limpar
            </button>
          )}
        </section>

        <p className={styles.filterResult} role="status" aria-live="polite">
          Exibindo {visibleItems.length} de {items.length}{" "}
          {items.length === 1 ? "anexo carregado" : "anexos carregados"}.
        </p>

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
                <h2 id="attachments-title">{historyMode ? adminHistory ? "Processamentos concluídos" : "Anexos lidos" : "Anexos recebidos"}</h2>
                <p>
                  {visibleItems.length}{" "}
                  {visibleItems.length === 1
                    ? historyMode
                      ? "item no histórico"
                      : "item para acompanhar"
                    : historyMode
                      ? "itens no histórico"
                      : "itens para acompanhar"}
                </p>
              </div>
              <span className={styles.countPill}>{visibleItems.length}</span>
            </div>
            <div className={styles.attachmentList}>
              {visibleItems.length === 0 ? (
                <div className={styles.emptyState}>
                  <Icon name="document" />
                  <strong>{historyMode ? "Nenhum anexo no histórico" : "Nenhum anexo encontrado"}</strong>
                  <span>
                    {historyMode
                      ? adminHistory
                        ? "Os anexos aparecem aqui quando o processamento termina."
                        : "Os anexos aparecem aqui depois de serem marcados como lidos."
                      : "Ajuste a busca ou os filtros para continuar."}
                  </span>
                </div>
              ) : (
                visibleItems
                  .slice()
                  .sort((a, b) =>
                    historyMode
                      ? adminHistory
                        ? dateSortKey(b.date) - dateSortKey(a.date)
                        : Date.parse(b.readAt ?? "") - Date.parse(a.readAt ?? "")
                      : dateSortKey(b.date) - dateSortKey(a.date),
                  )
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
                            {historyMode && !adminHistory && item.readAtLabel
                              ? `Lida em ${item.readAtLabel}${item.readBy ? ` por ${item.readBy}` : ""}`
                              : `${item.date}${item.work ? ` • ${item.work}` : ""}`}
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
                          {!historyMode ? (
                            <span className={`${styles.readDot} ${itemRead ? styles.readDotRead : ""}`} aria-label={itemRead ? "Lida" : "Não lida"} />
                          ) : null}
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
                  : `Página ${displayedPage} de ${displayedPageCount} • ${displayedTotal} ${displayedTotal === 1 ? "anexo" : "anexos"}`}
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
                    <p className={styles.kicker}>LEITURA DO ANEXO</p>
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
                      {totalFindingCount} {totalFindingCount === 1 ? "achado" : "achados"}
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
                ) : actionableFindings.length > 0 ? (
                  <div className={styles.findingsList}>
                    {previewFindings.map((finding, index) => {
                      const evidenceDetails = compactEvidenceDetails(finding);
                      const hasStructuredEvidence = Boolean(finding.evidenceDetails?.length);
                      const shortDescription = compactFindingDescription(
                        humanizeFindingText(finding.description),
                      );
                      const locationDetails = evidenceDetails.filter((part) =>
                        ["Campo", "Item", "Página"].includes(part.label),
                      );
                      const metaDetails = locationDetails.length
                        ? locationDetails
                        : evidenceDetails;
                      const findingMeta = [
                        ...metaDetails.map((part) =>
                          part.label === "Campo"
                            ? part.value
                            : `${part.label} ${part.value}`,
                        ),
                        finding.severity
                          ? `Gravidade ${severityLabel(finding.severity)}`
                          : findingCategoryLabel(finding.category),
                      ].filter(Boolean);
                      return (
                        <details
                          className={styles.findingCard}
                          key={`${finding.title}-${index}`}
                          open={index < 2}
                        >
                          <summary className={styles.findingSummary}>
                            <span className={styles.findingNumber}>
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.findingSummaryCopy}>
                              <strong>{humanizeFindingText(finding.title)}</strong>
                              <small>{findingMeta.join(" · ")}</small>
                            </span>
                            <span className={styles.findingToggle} aria-hidden="true">
                              <Icon name="chevron" />
                            </span>
                          </summary>
                          <div className={styles.findingBody}>
                            <p className={styles.findingBodyLead}>{shortDescription}</p>
                            {finding.expectedValue || finding.actualValue ? (
                              <div className={styles.comparisonGrid}>
                                {finding.expectedValue ? (
                                  <div>
                                    <span>Esperado</span>
                                    <strong>
                                      {formatFindingValueLines(finding.expectedValue).map(
                                        (line, lineIndex) => (
                                          <i key={`${line}-${lineIndex}`}>{line}</i>
                                        ),
                                      )}
                                    </strong>
                                  </div>
                                ) : null}
                                {finding.actualValue ? (
                                  <div>
                                    <span>Encontrado</span>
                                    <strong>
                                      {formatFindingValueLines(finding.actualValue).map(
                                        (line, lineIndex) => (
                                          <i key={`${line}-${lineIndex}`}>{line}</i>
                                        ),
                                      )}
                                    </strong>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {!hasStructuredEvidence && finding.evidence ? (
                              <div className={styles.evidenceBlock}>
                                <span>Trecho da evidência</span>
                                <p>{humanizeFindingText(finding.evidence)}</p>
                              </div>
                            ) : null}
                            {finding.justification ? (
                              <p className={styles.findingReason}>
                                <strong>Por que merece atenção:</strong>{" "}
                                {compactFindingDescription(
                                  humanizeFindingText(finding.justification),
                                )}
                              </p>
                            ) : null}
                          </div>
                        </details>
                      );
                    })}
                    {hiddenFindingCount > 0 ? (
                      <p className={styles.moreFindings}>
                        +{hiddenFindingCount} {hiddenFindingCount === 1 ? "outro achado" : "outros achados"} na análise completa
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className={selectedStatus === "Suspeita" ? styles.incompleteDiagnosis : styles.noFinding}>
                    <span className={selectedStatus === "Suspeita" ? styles.incompleteDiagnosisIcon : styles.noFindingIcon}>
                      <Icon name={selectedStatus === "Suspeita" ? "warning" : "check"} />
                    </span>
                    <div>
                      <strong>
                        {selectedStatus === "Suspeita"
                          ? "Diagnóstico sem detalhes estruturados"
                          : "Nenhuma inconsistência registrada"}
                      </strong>
                      <p>
                        {selectedStatus === "Suspeita"
                          ? "A classificação foi registrada como suspeita, mas os achados detalhados não estão disponíveis. Reprocesse o anexo no painel administrativo."
                          : "A IA não encontrou um achado para este anexo."}
                      </p>
                    </div>
                  </div>
                )}

                {informationalFindings.length > 0 ? (
                  <details className={styles.informationalFindings}>
                    <summary>
                      {informationalFindings.length === 1
                        ? "1 observação informativa"
                        : `${informationalFindings.length} observações informativas`}
                    </summary>
                    <div>
                      {informationalFindings.map((finding, index) => (
                        <article key={`${finding.title}-info-${index}`}>
                          <strong>{finding.title}</strong>
                          <p>{finding.description}</p>
                        </article>
                      ))}
                    </div>
                  </details>
                ) : null}

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
                  <Link className={styles.detailLink} href={`/notas/${selected.id}/analise-ia`}>
                    Ver nota detalhada <Icon name="chevron" />
                  </Link>
                  {historyMode ? (
                    <span className={styles.historyReadMeta}>
                      <Icon name="check" />
                      <span>
                        <strong>Marcada como lida</strong>
                        {selected.readAtLabel ? ` em ${selected.readAtLabel}` : ""}
                        {selected.readBy ? ` por ${selected.readBy}` : ""}
                      </span>
                    </span>
                  ) : (
                    <button
                      className={`${styles.readButton} ${isRead ? styles.readButtonDone : ""}`}
                      disabled={isRead || !canMarkRead || isMarkingRead}
                      onClick={markAsRead}
                      type="button"
                    >
                      <Icon name="check" />
                      {isRead
                        ? "Marcada como lida"
                        : isMarkingRead
                          ? "Marcando…"
                        : canMarkRead
                          ? "Marcar como lida"
                          : selectedNeedsContext
                            ? "Aguardando informação"
                            : "Aguardando análise"}
                    </button>
                  )}
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
    </Shell>
  );
}

function EmbeddedShell({ children }: { children: ReactNode }) {
  return children;
}

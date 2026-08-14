"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import type { NoteVisualItem } from "./note-types";
import styles from "./reviewer-mobile-notes-list.module.css";

type MobileTab = "all" | "ok" | "suspicious" | "unread";

type ReviewerMobileNotesListProps = {
  items: NoteVisualItem[];
  mode: "history" | "inbox";
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

function parsePtBrDate(value: string) {
  const parts = value.split("/").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, year] = parts;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function itemDate(item: NoteVisualItem, historyMode: boolean) {
  if (historyMode && item.readAt) {
    const readAt = new Date(item.readAt);
    if (!Number.isNaN(readAt.getTime())) return readAt;
  }
  return parsePtBrDate(item.date);
}

function dayDistance(date: Date | null) {
  if (!date) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((today.getTime() - target.getTime()) / 86_400_000);
}

function groupLabel(date: Date | null) {
  const distance = dayDistance(date);
  if (distance === 0) return "Hoje";
  if (distance === 1) return "Ontem";
  return "Anteriores";
}

function relativeLabel(item: NoteVisualItem, historyMode: boolean) {
  const date = itemDate(item, historyMode);
  const distance = dayDistance(date);
  if (distance === 0) return "Hoje";
  if (distance === 1) return "Há 1 dia";
  if (distance != null && distance > 1 && distance < 31) return `Há ${distance} dias`;
  return historyMode && item.readAtLabel ? item.readAtLabel : item.date;
}

function statusTone(status: string) {
  if (status === "Suspeita") return styles.suspicious;
  if (status === "OK") return styles.ok;
  if (status === "Falha de leitura" || status === "Falha de processamento") {
    return styles.failed;
  }
  if (status === "Precisa de informação" || status === "Informação insuficiente") {
    return styles.context;
  }
  return styles.processing;
}

function primaryReason(item: NoteVisualItem, status: string) {
  return item.findings?.find((finding) => finding.severity?.toUpperCase() !== "INFO")?.title
    ?? item.finding
    ?? (status === "OK" ? "Nenhuma inconsistência identificada" : status);
}

export function ReviewerMobileNotesList({
  items,
  mode,
}: ReviewerMobileNotesListProps) {
  const historyMode = mode === "history";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<MobileTab>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [period, setPeriod] = useState("");
  const [work, setWork] = useState("");
  const [responsible, setResponsible] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);

  const periods = useMemo(() => {
    const values = new Set<string>();
    items.forEach((item) => {
      const date = itemDate(item, historyMode);
      if (!date) return;
      values.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    });
    return [...values].sort((a, b) => b.localeCompare(a)).map((value) => {
      const [year, month] = value.split("-").map(Number);
      const label = new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
      }).format(new Date(year, month - 1, 1));
      return { label: label.charAt(0).toUpperCase() + label.slice(1), value };
    });
  }, [historyMode, items]);

  const works = useMemo(
    () => [...new Set(items.map((item) => item.work).filter(Boolean) as string[])].sort(),
    [items],
  );
  const responsibles = useMemo(
    () => [...new Set(items.map((item) => item.responsible).filter(Boolean) as string[])].sort(),
    [items],
  );

  const counts = useMemo(() => ({
    ok: items.filter((item) => statusLabel(item) === "OK").length,
    suspicious: items.filter((item) => statusLabel(item) === "Suspeita").length,
    unread: items.filter((item) => !item.isRead).length,
  }), [items]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return items
      .filter((item) => historyMode || !item.isRead)
      .filter((item) => {
        const itemStatus = statusLabel(item);
        if (tab === "suspicious" && itemStatus !== "Suspeita") return false;
        if (tab === "ok" && itemStatus !== "OK") return false;
        if (tab === "unread" && item.isRead) return false;
        if (work && item.work !== work) return false;
        if (responsible && item.responsible !== responsible) return false;
        if (normalizedQuery) {
          const haystack = `${item.number} ${item.supplier} ${item.work ?? ""}`.toLocaleLowerCase("pt-BR");
          if (!haystack.includes(normalizedQuery)) return false;
        }
        if (period) {
          const date = itemDate(item, historyMode);
          if (!date) return false;
          const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          if (value !== period) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aDate = itemDate(a, historyMode)?.getTime() ?? 0;
        const bDate = itemDate(b, historyMode)?.getTime() ?? 0;
        return newestFirst ? bDate - aDate : aDate - bDate;
      });
  }, [historyMode, items, newestFirst, period, query, responsible, tab, work]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, NoteVisualItem[]>();
    visibleItems.forEach((item) => {
      const label = groupLabel(itemDate(item, historyMode));
      groups.set(label, [...(groups.get(label) ?? []), item]);
    });
    return ["Hoje", "Ontem", "Anteriores"]
      .map((label) => ({ items: groups.get(label) ?? [], label }))
      .filter((group) => group.items.length > 0);
  }, [historyMode, visibleItems]);

  const filtersActive = Boolean(period || work || responsible);

  return (
    <section className={styles.mobilePage} aria-label={historyMode ? "Histórico mobile" : "Notas mobile"}>
      <header className={styles.heading}>
        <h1>{historyMode ? "Histórico" : "Notas"}</h1>
        <p>
          {historyMode
            ? "Anexos acompanhados"
            : <><strong>{items.length}</strong> anexos <span>•</span> <strong>{counts.suspicious}</strong> suspeitos</>}
        </p>
      </header>

      <label className={styles.search}>
        <Icon name="search" />
        <span className={styles.srOnly}>Buscar nota ou fornecedor</span>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar nota ou fornecedor"
          value={query}
        />
      </label>

      {!historyMode ? (
        <div className={styles.tabs} role="tablist" aria-label="Filtrar anexos rapidamente">
          <button aria-selected={tab === "all"} onClick={() => setTab("all")} role="tab" type="button">Todas</button>
          <button aria-selected={tab === "suspicious"} onClick={() => setTab("suspicious")} role="tab" type="button">
            Suspeitas <span className={styles.orangeCount}>{counts.suspicious}</span>
          </button>
          <button aria-selected={tab === "unread"} onClick={() => setTab("unread")} role="tab" type="button">
            Não lidas <span className={styles.blueCount}>{counts.unread}</span>
          </button>
        </div>
      ) : null}

      <button
        aria-expanded={filtersOpen}
        className={styles.filterButton}
        onClick={() => setFiltersOpen((current) => !current)}
        type="button"
      >
        <Icon name="filter" /> Filtros {filtersActive ? <span aria-label="Filtros ativos" /> : null}
      </button>

      {filtersOpen ? (
        <div className={styles.filterSheet}>
          <label>
            <span>Período</span>
            <select onChange={(event) => setPeriod(event.target.value)} value={period}>
              <option value="">Todos os meses</option>
              {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>Obra</span>
            <select onChange={(event) => setWork(event.target.value)} value={work}>
              <option value="">Todas as obras</option>
              {works.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {responsibles.length ? (
            <label>
              <span>Responsável</span>
              <select onChange={(event) => setResponsible(event.target.value)} value={responsible}>
                <option value="">Todos os responsáveis</option>
                {responsibles.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ) : null}
          {filtersActive ? (
            <button className={styles.clearFilters} onClick={() => { setPeriod(""); setWork(""); setResponsible(""); }} type="button">
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : null}

      {!historyMode ? (
        <button className={styles.orderButton} onClick={() => setNewestFirst((current) => !current)} type="button">
          Prioridade: <strong>{newestFirst ? "mais recentes" : "mais antigas"}</strong> <Icon name="chevron" />
        </button>
      ) : null}

      <div className={styles.groups}>
        {groupedItems.length ? groupedItems.map((group) => (
          <section className={styles.dayGroup} key={group.label}>
            <h2>{group.label}</h2>
            <div className={styles.cards}>
              {group.items.map((item, index) => {
                const itemStatus = statusLabel(item);
                return (
                  <Link className={`${styles.card} ${statusTone(itemStatus)}`} href={`/notas/${item.id}/analise-ia`} key={item.id}>
                    <span className={styles.cardIcon}>
                      <Icon name={itemStatus === "Suspeita" ? "warning" : itemStatus === "OK" ? "check" : "document"} />
                    </span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardTopline}>
                        <strong>{item.number}</strong>
                        <small>{relativeLabel(item, historyMode)}</small>
                      </span>
                      <span className={styles.supplier}>{item.supplier}</span>
                      {item.work ? <span className={styles.work}>Obra: {item.work}</span> : null}
                      {!historyMode ? <span className={styles.reason}>{primaryReason(item, itemStatus)}</span> : null}
                      <span className={styles.cardFooter}>
                        <em>{itemStatus}</em>
                        <strong>{item.value}</strong>
                      </span>
                    </span>
                    <span className={styles.chevron}><Icon name="chevron" /></span>
                    {!historyMode && tab === "suspicious" ? <span className={styles.priorityNumber}>{String(index + 1).padStart(2, "0")}</span> : null}
                  </Link>
                );
              })}
            </div>
          </section>
        )) : (
          <div className={styles.empty}>
            <Icon name="document" />
            <strong>Nenhum anexo encontrado</strong>
            <span>Ajuste a busca ou os filtros para continuar.</span>
          </div>
        )}
      </div>
    </section>
  );
}

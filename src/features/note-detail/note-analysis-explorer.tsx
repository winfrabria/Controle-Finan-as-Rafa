"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  compactFindingFieldPath,
  formatFindingParts,
  formatFindingValueLines,
  humanizeFindingText,
} from "@/features/internal-notes/finding-display";

import type {
  NoteDetailFinding,
  NoteDetailItem,
} from "./data";
import {
  formatDecimal,
  jsonSummary,
  severityLabel,
} from "./note-detail-format";
import styles from "./note-detail.module.css";

export function NoteAnalysisExplorer({
  findings,
  items,
}: {
  findings: NoteDetailFinding[];
  items: NoteDetailItem[];
}) {
  const [selectedId, setSelectedId] = useState(findings[0]?.id ?? "");
  const detailRef = useRef<HTMLElement>(null);
  const selected =
    findings.find((finding) => finding.id === selectedId) ?? findings[0] ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth > 1023) return;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  if (!selected) {
    return (
      <section className={styles.findingDetailPanel}>
        <div className={styles.emptyFinding}>
          <Icon name="check" /> A IA não registrou apontamentos nesta nota.
        </div>
      </section>
    );
  }

  const affectedItem =
    items.find((item) => item.id === selected.affectedItem?.id) ?? null;
  const selectedIndex = findings.findIndex(
    (finding) => finding.id === selected.id,
  );
  const evidenceObservations = extractEvidenceObservations(selected.evidence);
  const evidenceParts = formatFindingParts(
    selected.evidence,
    selected.description,
  ).filter((part) => {
    const label = part.label.trim().toLocaleLowerCase("pt-BR");
    const value = part.value.trim().toLocaleLowerCase("pt-BR");
    const description = selected.description.trim().toLocaleLowerCase("pt-BR");
    if (!value || value === "—" || label === "fonte") return false;
    if (
      (label === "evidência" || label === "resumo da evidência") &&
      (value === description || description.includes(value))
    ) {
      return false;
    }
    return true;
  });
  const evidenceLocationParts = evidenceParts
    .filter((part) => ["Campo", "Item", "Página"].includes(part.label))
    .map((part) => ({
      ...part,
      value:
        part.label === "Campo"
          ? compactFindingFieldPath(part.value)
          : part.value,
    }));
  const evidenceNarrativeParts = evidenceParts
    .filter(
      (part) =>
        !["Campo", "Item", "Página", "Observations", "Observações"].includes(
          part.label,
        ),
    )
    .slice(0, 4);
  const hasMeaningfulComparison =
    selected.expectedValue !== null &&
    selected.actualValue !== null &&
    jsonSummary(selected.expectedValue) !== jsonSummary(selected.actualValue);

  const selectFinding = (index: number) => {
    const next = findings[index];
    if (next) setSelectedId(next.id);
  };

  return (
    <>
      <section className={styles.analysisOverview} aria-label="Resumo da análise">
        <div>
          <span>Diagnóstico estruturado</span>
          <strong>
            {findings.length} {findings.length === 1 ? "apontamento" : "apontamentos"}
          </strong>
          <small>
            Evidência e comparação organizadas para consulta rápida.
          </small>
        </div>
        <div className={styles.analysisProgress}>
          <span>
            Apontamento {selectedIndex + 1} de {findings.length}
          </span>
          <div
            aria-label={`${selectedIndex + 1} de ${findings.length}`}
            aria-valuemax={findings.length}
            aria-valuemin={1}
            aria-valuenow={selectedIndex + 1}
            role="progressbar"
          >
            <i
              style={{
                width: `${((selectedIndex + 1) / findings.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </section>

      <div className={styles.analysisLayout}>
      <aside className={styles.findingsPanel}>
        <h2>
          {findings.length} {findings.length === 1 ? "apontamento identificado" : "apontamentos identificados"}
        </h2>
        <p>Selecione um apontamento para ver os detalhes.</p>
        <div className={styles.findingList}>
          {findings.map((finding, index) => (
            <button
              key={finding.id}
              type="button"
              data-active={finding.id === selected.id}
              aria-pressed={finding.id === selected.id}
              onClick={() => setSelectedId(finding.id)}
            >
              <span className={styles.findingNumber}>{index + 1}</span>
              <span>
                <strong>{humanizeFindingText(finding.title)}</strong>
                <small>
                  {compactFindingDescription(humanizeFindingText(finding.description))}
                </small>
                <small className={styles.severityBadge}>
                  Gravidade: {severityLabel(finding.severity)}
                </small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </aside>

      <article className={styles.findingDetailPanel} key={selected.id} ref={detailRef}>
        <nav className={styles.findingPager} aria-label="Navegação entre apontamentos">
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => selectFinding(selectedIndex - 1)}
          >
            <Icon name="chevron" /> Anterior
          </button>
          <span>{selectedIndex + 1} de {findings.length}</span>
          <button
            type="button"
            disabled={selectedIndex >= findings.length - 1}
            onClick={() => selectFinding(selectedIndex + 1)}
          >
            Próximo <Icon name="chevron" />
          </button>
        </nav>
        <header className={styles.findingDetailTitle}>
          <span className={styles.findingNumber}>{selectedIndex + 1}</span>
          <div>
            <h2>{humanizeFindingText(selected.title)}</h2>
            <span className={styles.severityBadge}>
              Gravidade: {severityLabel(selected.severity)}
            </span>
          </div>
        </header>
        <p className={styles.findingLead}>
          {humanizeFindingText(selected.description)}
        </p>

        <FindingSection defaultOpen icon="document" title="Evidência no documento">
          {evidenceObservations.length ? (
            <EvidenceObservationList observations={evidenceObservations} />
          ) : (
            <EvidenceFacts
              parts={
                evidenceNarrativeParts.length
                  ? evidenceNarrativeParts
                  : evidenceLocationParts
              }
            />
          )}
        </FindingSection>
        <FindingSection defaultOpen icon="search" title="Por que chamou atenção">
          {humanizeFindingText(selected.explanation)}
        </FindingSection>
        <FindingSection icon="shield" title="Critério usado na conferência">
          {humanizeFindingText(
            selected.rule?.description ??
              selected.rule?.name ??
              "Análise baseada nos dados observáveis deste documento.",
          )}
        </FindingSection>

        {hasMeaningfulComparison ? (
          <section className={styles.comparison}>
          <div>
            <h3>Esperado</h3>
            <p>
              {formatFindingValueLines(
                jsonSummary(selected.expectedValue, "Sem referência comparável"),
              ).map((line, index) => (
                <span key={`${line}-${index}`}>{line}</span>
              ))}
            </p>
          </div>
          <div>
            <h3>Encontrado</h3>
            <p>
              {formatFindingValueLines(jsonSummary(selected.actualValue)).map(
                (line, index) => (
                  <span key={`${line}-${index}`}>{line}</span>
                ),
              )}
            </p>
          </div>
          </section>
        ) : null}

      </article>

      <aside className={styles.analysisAside}>
        <details className={styles.analysisAccordion} open>
          <summary><h2>Onde conferir</h2></summary>
          <p>Localização do apontamento no arquivo original.</p>
          {evidenceLocationParts.length ? (
            <EvidenceFacts parts={evidenceLocationParts.slice(0, 3)} />
          ) : null}
          {affectedItem || selected.affectedItem ? (
            <article className={styles.analysisEvidenceCard}>
              <span className={styles.analysisEvidenceEyebrow}>Item relacionado</span>
              <strong>
                {affectedItem?.description ??
                  selected.affectedItem?.description ??
                  "Item identificado no documento"}
              </strong>
              <dl>
                <div><dt>Código</dt><dd>{affectedItem?.code ?? selected.affectedItem?.code ?? "Não identificado"}</dd></div>
                <div><dt>Unidade</dt><dd>{affectedItem?.unit ?? "Não identificada"}</dd></div>
                <div><dt>Quantidade</dt><dd>{formatDecimal(affectedItem?.quantity ?? null, 0)}</dd></div>
                <div><dt>Valor unitário</dt><dd>{formatDecimal(affectedItem?.unitPrice ?? null)}</dd></div>
                <div><dt>Valor total</dt><dd>{formatDecimal(affectedItem?.totalAmount ?? null)}</dd></div>
              </dl>
            </article>
          ) : (
            <p className={styles.analysisEvidenceEmpty}>
              Confira a evidência no arquivo original exibido logo abaixo.
            </p>
          )}
        </details>

        <details className={styles.analysisAccordion}>
          <summary><h2>Limitações da análise</h2></summary>
          <ul className={styles.limitationsList}>
            <li>
              A análise considera as informações disponíveis na nota e as referências
              cadastradas para a obra.
            </li>
            <li>
              Alterações contratuais não cadastradas ou documentos externos não enviados
              podem não ter sido considerados.
            </li>
            <li>
              Uma referência externa genérica nunca comprova divergência sozinha.
            </li>
          </ul>
        </details>
      </aside>
      </div>
    </>
  );
}

type EvidenceObservation = {
  amount: string | number | null;
  date: string | null;
  documentGroup: string | null;
  kind: "SHEET" | "RECEIPT" | "SALE" | "PAYMENT" | "DISCOUNT" | "OTHER";
  label: string | null;
  page: number | null;
  text: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractEvidenceObservations(value: unknown): EvidenceObservation[] {
  if (!isRecord(value) || !Array.isArray(value.observations)) return [];

  return value.observations.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const kind = typeof entry.kind === "string" ? entry.kind.toUpperCase() : "OTHER";
    if (!["SHEET", "RECEIPT", "SALE", "PAYMENT", "DISCOUNT", "OTHER"].includes(kind)) {
      return [];
    }
    return [{
      amount:
        typeof entry.amount === "string" || typeof entry.amount === "number"
          ? entry.amount
          : null,
      date: typeof entry.date === "string" ? entry.date : null,
      documentGroup:
        typeof entry.documentGroup === "string" ? entry.documentGroup : null,
      kind: kind as EvidenceObservation["kind"],
      label: typeof entry.label === "string" ? entry.label : null,
      page: typeof entry.page === "number" ? entry.page : null,
      text: typeof entry.text === "string" ? entry.text : null,
    }];
  });
}

const observationKindLabel: Record<EvidenceObservation["kind"], string> = {
  SHEET: "Ficha ou controle",
  RECEIPT: "Recibo ou cupom",
  SALE: "Venda ou pedido",
  PAYMENT: "Pagamento",
  DISCOUNT: "Desconto",
  OTHER: "Outro registro",
};

function formatObservationDate(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatObservationAmount(value: string | number | null) {
  if (value === null) return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(amount)
    : String(value);
}

function EvidenceObservationList({ observations }: { observations: EvidenceObservation[] }) {
  return (
    <div className={styles.evidenceObservationList}>
      {observations.map((observation, index) => {
        const amount = formatObservationAmount(observation.amount);
        const date = formatObservationDate(observation.date);
        return (
          <article key={`${observation.kind}:${observation.page ?? ""}:${observation.label ?? ""}:${index}`}>
            <header>
              <span>{observationKindLabel[observation.kind]}</span>
              <div>
                {observation.page ? <small>Página {observation.page}</small> : null}
                {date ? <small>{date}</small> : null}
                {amount ? <strong>{amount}</strong> : null}
              </div>
            </header>
            {observation.label ? <h4>{observation.label}</h4> : null}
            {observation.text ? <p>{humanizeFindingText(observation.text)}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function EvidenceFacts({ parts }: { parts: ReturnType<typeof formatFindingParts> }) {
  if (parts.length === 0) return <span>Evidência não detalhada.</span>;

  return (
    <dl className={styles.evidenceFacts}>
      {parts.map((part, index) => (
        <div key={`${part.label}:${index}`}>
          <dt>{part.label}</dt>
          <dd>{part.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function compactFindingDescription(description: string) {
  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length <= 170) return normalized;

  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= 190) return firstSentence;
  return `${normalized.slice(0, 167).trimEnd()}…`;
}

function FindingSection({
  children,
  defaultOpen = false,
  icon,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  icon: "building" | "document" | "search" | "shield";
  title: string;
}) {
  return (
    <details className={styles.findingSection} open={defaultOpen}>
      <summary>
        <Icon name={icon} />
        <h3>{title}</h3>
      </summary>
      <div className={styles.findingSectionBody}>{children}</div>
    </details>
  );
}

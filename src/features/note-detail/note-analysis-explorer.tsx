"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  compactFindingFieldPath,
  formatFindingParts,
  formatFindingValueLines,
  formatReviewerFindingParts,
  humanizeFindingText,
  humanizeReviewerFindingText,
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
import {
  findingComparisonDifference,
  findingComparisonLabels,
} from "./finding-comparison-labels";
import {
  extractFindingEvidenceObservations,
  findingObservationKindLabel,
  formatFindingObservationAmount,
  formatFindingObservationDate,
  reviewerTextIsDistinct,
  type FindingEvidenceObservation,
} from "./finding-observations";
import styles from "./note-detail.module.css";

export function NoteAnalysisExplorer({
  findings,
  items,
  reviewer,
}: {
  findings: NoteDetailFinding[];
  items: NoteDetailItem[];
  reviewer: boolean;
}) {
  const [selectedId, setSelectedId] = useState(findings[0]?.id ?? "");
  const detailRef = useRef<HTMLElement>(null);
  const selected =
    findings.find((finding) => finding.id === selectedId) ?? findings[0] ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth > 1023) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    detailRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
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
  const displayText = reviewer
    ? humanizeReviewerFindingText
    : humanizeFindingText;
  const selectedTitle = displayText(selected.title);
  const selectedDescription = displayText(selected.description);
  const selectedExplanation = displayText(selected.explanation);
  const selectedRule = displayText(
    selected.rule?.description ??
      selected.rule?.name ??
      "Análise baseada nos dados observáveis deste documento.",
  );
  const evidenceObservations = extractFindingEvidenceObservations(
    selected.evidence,
  );
  const evidenceParts = (reviewer
    ? formatReviewerFindingParts
    : formatFindingParts)(
    selected.evidence,
    selected.description,
  )
    .map((part) => ({ ...part, value: displayText(part.value) }))
    .filter((part) => {
    const label = part.label.trim().toLocaleLowerCase("pt-BR");
    const value = part.value.trim().toLocaleLowerCase("pt-BR");
    const description = selectedDescription.trim().toLocaleLowerCase("pt-BR");
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
    .filter((part) =>
      reviewerTextIsDistinct(part.value, [
        selectedTitle,
        selectedDescription,
        selectedExplanation,
      ]),
    );
  const hasMeaningfulComparison =
    selected.expectedValue !== null &&
    selected.actualValue !== null &&
    jsonSummary(selected.expectedValue) !== jsonSummary(selected.actualValue);
  const comparisonLabels = findingComparisonLabels(selected);
  const comparisonDifference = findingComparisonDifference(selected);
  const showExplanation = reviewerTextIsDistinct(selectedExplanation, [
    selectedDescription,
  ]);
  const showRule = reviewerTextIsDistinct(selectedRule, [
    selectedDescription,
    selectedExplanation,
  ]);

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
                <strong>{displayText(finding.title)}</strong>
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
            <h2>{selectedTitle}</h2>
            <span className={styles.severityBadge}>
              Gravidade: {severityLabel(selected.severity)}
            </span>
          </div>
        </header>
        <p className={styles.findingLead}>
          {selectedDescription}
        </p>

        <FindingSection defaultOpen icon="document" title="Evidência no documento">
          {evidenceObservations.length ? (
            <EvidenceObservationList
              comparedWith={[selectedDescription, selectedExplanation]}
              observations={evidenceObservations}
              reviewer={reviewer}
            />
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
        {showExplanation ? (
          <FindingSection defaultOpen icon="search" title="Por que chamou atenção">
            {selectedExplanation}
          </FindingSection>
        ) : null}
        {showRule ? (
          <FindingSection icon="shield" title="Critério usado na conferência">
            {selectedRule}
          </FindingSection>
        ) : null}

        {hasMeaningfulComparison ? (
          <section className={styles.comparison}>
          <div>
            <h3>{comparisonLabels.expected}</h3>
            <p>
              {formatFindingValueLines(
                jsonSummary(selected.expectedValue, "Sem referência comparável"),
              ).map(displayText).map((line, index) => (
                <span key={`${line}-${index}`}>{line}</span>
              ))}
            </p>
          </div>
          <div>
            <h3>{comparisonLabels.actual}</h3>
            <p>
              {formatFindingValueLines(jsonSummary(selected.actualValue)).map(displayText).map(
                (line, index) => (
                  <span key={`${line}-${index}`}>{line}</span>
                ),
              )}
            </p>
          </div>
          {comparisonDifference ? (
            <div className={styles.comparisonDifference}>
              <h3>Diferença</h3>
              <strong>{comparisonDifference}</strong>
            </div>
          ) : null}
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
                {displayText(
                  affectedItem?.description ??
                    selected.affectedItem?.description ??
                    "Item identificado no documento",
                )}
              </strong>
              <dl>
                {!reviewer || !isInternalDocumentCode(affectedItem?.code ?? selected.affectedItem?.code) ? (
                  <div><dt>Código</dt><dd>{affectedItem?.code ?? selected.affectedItem?.code ?? "Não identificado"}</dd></div>
                ) : null}
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

function EvidenceObservationList({
  comparedWith,
  observations,
  reviewer,
}: {
  comparedWith: string[];
  observations: FindingEvidenceObservation[];
  reviewer: boolean;
}) {
  const displayText = reviewer
    ? humanizeReviewerFindingText
    : humanizeFindingText;

  return (
    <div className={styles.evidenceObservationList}>
      {observations.map((observation, index) => {
        const amount = formatFindingObservationAmount(observation.amount);
        const date = formatFindingObservationDate(observation.date);
        const label = observation.label
          ? displayText(observation.label)
          : null;
        const observationText = observation.text
          ? displayText(observation.text)
          : null;
        const showObservationText = reviewerTextIsDistinct(observationText, [
          ...comparedWith,
          label,
        ]);
        return (
          <article key={`${observation.kind}:${observation.page ?? ""}:${observation.label ?? ""}:${index}`}>
            <header>
              <span>{findingObservationKindLabel(observation.kind)}</span>
              <div>
                {observation.page ? <small>Página {observation.page}</small> : null}
                {date ? <small>{date}</small> : null}
                {amount ? <strong>{amount}</strong> : null}
              </div>
            </header>
            {label ? <h4>{label}</h4> : null}
            {showObservationText ? <p>{observationText}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function EvidenceFacts({ parts }: { parts: ReturnType<typeof formatReviewerFindingParts> }) {
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

function isInternalDocumentCode(value: string | null | undefined) {
  return Boolean(value && /^D\d{1,4}$/i.test(value.trim()));
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

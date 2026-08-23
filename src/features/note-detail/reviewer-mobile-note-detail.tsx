"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";
import {
  formatFindingValue,
  formatFindingValueLines,
  formatReviewerFindingParts,
  humanizeReviewerFindingText,
} from "@/features/internal-notes/finding-display";
import { Icon } from "@/features/workspace-ui/ui-icons";

import type { NoteDetailFinding, NoteDetailItem } from "./data";
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
import { NoteDocumentPreview } from "./note-document-preview";
import styles from "./reviewer-mobile-note-detail.module.css";

type ReviewerMobileNoteDetailProps = {
  classification: string;
  document: {
    fileName: string;
    isDemo: boolean;
    isImage: boolean;
    url: string | null;
  };
  findings: NoteDetailFinding[];
  issuedAt: string;
  items: NoteDetailItem[];
  noteId: string;
  number: string;
  supplier: string;
  supplierTaxId: string;
  total: string;
  work: string;
};

type ReadState = "idle" | "loading" | "done";

export function ReviewerMobileNoteDetail({
  classification,
  document,
  findings,
  issuedAt,
  items,
  noteId,
  number,
  supplier,
  supplierTaxId,
  total,
  work,
}: ReviewerMobileNoteDetailProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [readState, setReadState] = useState<ReadState>("idle");
  const [readError, setReadError] = useState<string | null>(null);
  const findingButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const documentDialog = useRef<HTMLDialogElement>(null);
  const selectedFinding = findings[selectedIndex] ?? null;

  function selectFinding(index: number, scroll = false) {
    if (index < 0 || index >= findings.length) return;
    setSelectedIndex(index);
    if (!scroll) return;

    window.requestAnimationFrame(() => {
      findingButtons.current[index]?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    });
  }

  async function markAsRead() {
    if (readState !== "idle") return;

    const endCriticalActivity = beginPwaCriticalActivity();
    setReadError(null);
    setReadState("loading");
    try {
      const response = await fetch(`/api/notas/${noteId}/read`, {
        headers: { Accept: "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { erro?: { mensagem?: string } }
          | null;
        throw new Error(
          payload?.erro?.mensagem ?? "Não foi possível marcar a nota como lida.",
        );
      }
      setReadState("done");
    } catch (error) {
      setReadState("idle");
      setReadError(
        error instanceof Error
          ? error.message
          : "Não foi possível marcar a nota como lida.",
      );
    } finally {
      endCriticalActivity();
    }
  }

  return (
    <section className={styles.mobileDetail} aria-label="Detalhe da nota">
      <header className={styles.appBar}>
        <Link className={styles.backButton} href="/revisao/notas" aria-label="Voltar para notas">
          <Icon name="chevron" />
        </Link>
        <strong title={number}>Nota {number}</strong>
        <span className={classificationClass(classification)}>
          <Icon name={classificationIcon(classification)} /> {classification}
        </span>
      </header>

      <div className={styles.mobileContent}>
        <header className={styles.diagnosisHeader}>
          <h1>Diagnóstico da IA</h1>
          <p>{findings.length} {findings.length === 1 ? "achado" : "achados"}</p>
        </header>

        {selectedFinding && findings.length > 1 ? (
          <nav
            className={styles.findingNavigator}
            aria-label="Selecionar achado"
          >
            <button
              aria-label="Achado anterior"
              disabled={selectedIndex === 0}
              onClick={() => selectFinding(selectedIndex - 1, true)}
              type="button"
            >
              <Icon name="chevron" />
            </button>
            <div>
              <span>Achado {selectedIndex + 1} de {findings.length}</span>
              <strong>{humanizeReviewerFindingText(selectedFinding.title)}</strong>
            </div>
            <button
              aria-label="Próximo achado"
              disabled={selectedIndex === findings.length - 1}
              onClick={() => selectFinding(selectedIndex + 1, true)}
              type="button"
            >
              <Icon name="chevron" />
            </button>
          </nav>
        ) : null}

        {findings.length ? (
          <div className={styles.findingStack}>
            {findings.map((finding, index) => {
              const expanded = index === selectedIndex;
              const detailId = `mobile-finding-${finding.id}`;
              return (
                <article
                  className={`${styles.findingCard} ${expanded ? styles.findingExpanded : ""}`}
                  data-severity={finding.severity}
                  key={finding.id}
                >
                  <button
                    aria-controls={detailId}
                    aria-expanded={expanded}
                    className={styles.findingHeader}
                    onClick={() => selectFinding(index)}
                    ref={(element) => {
                      findingButtons.current[index] = element;
                    }}
                    type="button"
                  >
                    <span className={styles.findingNumber}>{index + 1}</span>
                    <span className={styles.findingHeading}>
                      <strong>{humanizeReviewerFindingText(finding.title)}</strong>
                      <small>{mobileSeverityLabel(finding.severity)}</small>
                    </span>
                    <Icon className={expanded ? styles.chevronOpen : undefined} name="chevron" />
                  </button>

                    {expanded ? (
                      <FindingBody
                        finding={finding}
                        id={detailId}
                      />
                    ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <section className={styles.noFindings}>
            <Icon name="check" />
            <div>
              <strong>Nenhum achado identificado</strong>
              <p>A análise não registrou divergências nesta nota.</p>
            </div>
          </section>
        )}

        <section className={styles.noteSummary} aria-labelledby="mobile-note-summary-title">
          <h2 id="mobile-note-summary-title">Resumo da nota</h2>
          <dl>
            <SummaryRow icon="help" label="Fornecedor" value={supplier} />
            <SummaryRow icon="building" label="Obra" value={work} />
            <SummaryRow icon="calendar" label="Emissão" value={issuedAt} />
            <SummaryRow green icon="money" label="Valor da nota" value={total} />
          </dl>
          <button
            className={styles.openDocument}
            onClick={() => documentDialog.current?.showModal()}
            type="button"
          >
            <Icon name="document" />
            <span>Abrir nota fiscal</span>
            <Icon name="chevron" />
          </button>
        </section>

        <details className={styles.extractedData}>
          <summary>
            <span>
              <strong>Dados extraídos</strong>
              <small>Campos principais identificados na nota fiscal.</small>
            </span>
            <Icon name="chevron" />
          </summary>
          <dl>
            <div><dt>Número da nota</dt><dd>{number}</dd></div>
            <div><dt>Fornecedor</dt><dd>{supplier}</dd></div>
            <div><dt>CNPJ do fornecedor</dt><dd>{supplierTaxId}</dd></div>
            <div><dt>Data de emissão</dt><dd>{issuedAt}</dd></div>
            <div><dt>Valor total</dt><dd>{total}</dd></div>
            <div><dt>Obra</dt><dd>{work}</dd></div>
            <div><dt>Itens identificados</dt><dd>{items.length}</dd></div>
          </dl>
        </details>

        {readError ? <p className={styles.readError} role="alert">{readError}</p> : null}
      </div>

      <div className={styles.readBar}>
        <button
          className={readState === "done" ? styles.readDone : undefined}
          disabled={readState !== "idle"}
          onClick={markAsRead}
          type="button"
        >
          <Icon name="check" />
          {readState === "loading"
            ? "Marcando…"
            : readState === "done"
              ? "Marcada como lida"
              : "Marcar como lida"}
        </button>
      </div>

      <dialog
        aria-labelledby="mobile-document-title"
        className={styles.documentDialog}
        onClick={(event) => {
          if (event.currentTarget === event.target) event.currentTarget.close();
        }}
        ref={documentDialog}
      >
        <header>
          <div>
            <span>Arquivo original</span>
            <h2 id="mobile-document-title">Nota {number}</h2>
          </div>
          <button
            aria-label="Fechar nota fiscal"
            onClick={() => documentDialog.current?.close()}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className={styles.documentDialogBody}>
          <NoteDocumentPreview
            documentUrl={document.url}
            fileName={document.fileName}
            isDemo={document.isDemo}
            isImage={document.isImage}
            items={items}
            number={number}
            supplier={supplier}
            total={total}
          />
        </div>
      </dialog>
    </section>
  );
}

function FindingBody({
  finding,
  id,
}: {
  finding: NoteDetailFinding;
  id: string;
}) {
  const description = humanizeReviewerFindingText(finding.description);
  const explanation = humanizeReviewerFindingText(finding.explanation);
  const { evidence, observations, references } = findingEvidence(
    finding,
    description,
    explanation,
  );
  const labels = findingComparisonLabels(finding);
  const difference = findingComparisonDifference(finding);
  const expected = formatFindingValueLines(
    formatFindingValue(finding.expectedValue, "Sem referência comparável"),
  ).map(humanizeReviewerFindingText);
  const actual = formatFindingValueLines(
    formatFindingValue(finding.actualValue, "Não informado"),
  ).map(humanizeReviewerFindingText);
  const hasMeaningfulComparison =
    finding.expectedValue !== null &&
    finding.actualValue !== null &&
    formatFindingValue(finding.expectedValue) !==
      formatFindingValue(finding.actualValue);
  const showExplanation = reviewerTextIsDistinct(explanation, [description]);

  return (
    <div className={styles.findingBody} id={id}>
      <FindingSection title="O que foi identificado">
        <p>{description}</p>
      </FindingSection>

      {observations.length || evidence.length ? (
        <FindingSection title="Evidências no documento">
          {observations.length ? (
            <MobileEvidenceObservations
              comparedWith={[description, explanation]}
              observations={observations}
            />
          ) : null}
          {evidence.length ? (
            <dl className={styles.evidenceList}>
              {evidence.map((part, partIndex) => (
                <div key={`${part.label}:${partIndex}`}>
                  <dt>{part.label}</dt>
                  <dd>{part.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </FindingSection>
      ) : null}

      {references.length ? (
        <FindingSection title="Contrato / referência usada">
          <ul className={styles.referenceList}>
            {references.map((reference) => <li key={reference}>{reference}</li>)}
          </ul>
        </FindingSection>
      ) : null}

      {hasMeaningfulComparison ? (
        <section className={styles.comparison} aria-label="Comparativo do achado">
          <div>
            <h3>{labels.expected}</h3>
            <p>{expected.map((line) => <span key={line}>{line}</span>)}</p>
          </div>
          <div>
            <h3>{labels.actual}</h3>
            <p>{actual.map((line) => <span key={line}>{line}</span>)}</p>
          </div>
          {difference ? (
            <div className={styles.comparisonDifference}>
              <h3>Diferença</h3>
              <strong>{difference}</strong>
            </div>
          ) : null}
        </section>
      ) : null}

      {showExplanation ? (
        <FindingSection title="Por que chamou atenção">
          <p>{explanation}</p>
        </FindingSection>
      ) : null}

    </div>
  );
}

function FindingSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={styles.findingSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MobileEvidenceObservations({
  comparedWith,
  observations,
}: {
  comparedWith: string[];
  observations: FindingEvidenceObservation[];
}) {
  return (
    <div className={styles.observationList}>
      {observations.map((observation, index) => {
        const amount = formatFindingObservationAmount(observation.amount);
        const date = formatFindingObservationDate(observation.date);
        const label = observation.label
          ? humanizeReviewerFindingText(observation.label)
          : null;
        const text = observation.text
          ? humanizeReviewerFindingText(observation.text)
          : null;
        const showText = reviewerTextIsDistinct(text, [
          ...comparedWith,
          label,
        ]);

        return (
          <article
            key={`${observation.kind}:${observation.page ?? ""}:${observation.label ?? ""}:${index}`}
          >
            <header>
              <strong>{findingObservationKindLabel(observation.kind)}</strong>
              {amount ? <b>{amount}</b> : null}
            </header>
            <div className={styles.observationMeta}>
              {observation.page ? <span>Página {observation.page}</span> : null}
              {date ? <span>{date}</span> : null}
            </div>
            {label ? <h4>{label}</h4> : null}
            {showText ? <p>{text}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function SummaryRow({
  green = false,
  icon,
  label,
  value,
}: {
  green?: boolean;
  icon: "building" | "calendar" | "help" | "money";
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className={green ? styles.summaryIconGreen : styles.summaryIcon}><Icon name={icon} /></span>
      <div><dt>{label}</dt><dd>{value}</dd></div>
    </div>
  );
}

function findingEvidence(
  finding: NoteDetailFinding,
  description: string,
  explanation: string,
) {
  const rawParts = formatReviewerFindingParts(finding.evidence, finding.description);
  const evidence = rawParts
    .filter((part) => !isReferenceLabel(part.label))
    .map((part) => ({
      ...part,
      value: humanizeReviewerFindingText(part.value),
    }))
    .filter((part) =>
      reviewerTextIsDistinct(part.value, [description, explanation]),
    );
  const references = [
    ...finding.sources
      .filter((source) => source.kind === "reference")
      .map((source) => source.label),
    ...rawParts.filter((part) => isReferenceLabel(part.label)).map((part) => part.value),
  ].map(humanizeReviewerFindingText);

  return {
    evidence,
    observations: extractFindingEvidenceObservations(finding.evidence),
    references: [...new Map(references.map((value) => [normalizedValue(value), value])).values()],
  };
}

function isReferenceLabel(value: string) {
  return /refer[eê]ncia|contrato|fonte|se[cç][aã]o|documento usado/i.test(value);
}

function normalizedValue(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function mobileSeverityLabel(value: string) {
  if (value === "CRITICAL") return "Crítica";
  if (value === "WARNING") return "Atenção";
  return "Informativa";
}

function classificationClass(classification: string) {
  const normalized = normalizedValue(classification);
  if (normalized === "ok") return `${styles.classification} ${styles.classificationOk}`;
  if (normalized.includes("suspeit") || normalized.includes("aten")) {
    return `${styles.classification} ${styles.classificationWarning}`;
  }
  if (normalized.includes("falha")) {
    return `${styles.classification} ${styles.classificationDanger}`;
  }
  return `${styles.classification} ${styles.classificationInfo}`;
}

function classificationIcon(classification: string) {
  return normalizedValue(classification) === "ok" ? "check" : "warning";
}

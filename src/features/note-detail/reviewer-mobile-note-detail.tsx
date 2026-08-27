"use client";

import Link from "next/link";
import type { MouseEvent, RefObject } from "react";
import { useRef, useState } from "react";

import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";
import {
  formatFindingValue,
  formatFindingValueLines,
  formatReviewerFindingParts,
  humanizeReviewerFindingText,
} from "@/features/internal-notes/finding-display";
import { Icon } from "@/features/workspace-ui/ui-icons";

import type {
  NoteDetailAuditFeedback,
  NoteDetailFinding,
  NoteDetailItem,
} from "./data";
import { AuditFeedbackPanel } from "./audit-feedback-panel";
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
  assurance: { band: "HIGH" | "MEDIUM" | "LIMITED"; reason: string } | null;
  classification: string;
  document: {
    fileName: string;
    isDemo: boolean;
    isImage: boolean;
    url: string | null;
  };
  findings: NoteDetailFinding[];
  feedback: NoteDetailAuditFeedback | null;
  feedbackEnabled: boolean;
  issuedAt: string;
  items: NoteDetailItem[];
  noteId: string;
  noteVersion: number;
  number: string;
  supplier: string;
  supplierTaxId: string;
  total: string;
  work: string;
};

type ReadState = "idle" | "loading" | "done";

export function ReviewerMobileNoteDetail({
  assurance,
  document,
  feedback,
  feedbackEnabled,
  findings,
  issuedAt,
  items,
  noteId,
  noteVersion,
  number,
  supplier,
  supplierTaxId,
  total,
  work,
}: ReviewerMobileNoteDetailProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [readState, setReadState] = useState<ReadState>("idle");
  const [readError, setReadError] = useState<string | null>(null);
  const documentDialog = useRef<HTMLDialogElement>(null);
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const selectedFinding = findings[selectedIndex] ?? null;

  function selectFinding(index: number) {
    if (index < 0 || index >= findings.length) return;
    evidenceDialog.current?.close();
    setSelectedIndex(index);
    window.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      top: 0,
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
        <Link className={styles.iconButton} href="/revisao/notas" aria-label="Voltar para notas">
          <Icon name="chevron" />
        </Link>
        <div className={styles.appBarTitle}>
          <strong>Diagnóstico da IA</strong>
          <span>
            {findings.length
              ? `${selectedIndex + 1} de ${findings.length}`
              : "Sem achados"}
          </span>
        </div>
        <button
          aria-label="Abrir nota fiscal"
          className={styles.iconButton}
          onClick={() => openDialog(documentDialog)}
          type="button"
        >
          <Icon name="document" />
        </button>
      </header>

      <div className={styles.mobileContent}>
        {selectedFinding ? (
          <FindingSummary
            finding={selectedFinding}
            index={selectedIndex}
            onOpenEvidence={() => openDialog(evidenceDialog)}
          />
        ) : (
          <section className={styles.noFindings}>
            <Icon name="check" />
            <div>
              <strong>Nenhum achado identificado</strong>
              <p>A análise não registrou divergências nesta nota.</p>
            </div>
          </section>
        )}

        <details className={styles.noteSummary}>
          <summary>
            <span>
              <strong>Resumo da nota</strong>
              <small>Fornecedor, obra e dados extraídos.</small>
            </span>
            <Icon name="chevron" />
          </summary>
          <div className={styles.noteSummaryBody}>
            <dl>
              <SummaryRow icon="help" label="Fornecedor" value={supplier} />
              <SummaryRow icon="building" label="Obra" value={work} />
              <SummaryRow icon="calendar" label="Emissão" value={issuedAt} />
              <SummaryRow green icon="money" label="Valor da nota" value={total} />
            </dl>
            <dl className={styles.extractedGrid}>
              <div><dt>Número da nota</dt><dd>{number}</dd></div>
              <div><dt>CNPJ do fornecedor</dt><dd>{supplierTaxId}</dd></div>
              <div><dt>Itens identificados</dt><dd>{items.length}</dd></div>
            </dl>
          </div>
        </details>

        <AuditFeedbackPanel
          assurance={assurance}
          currentFeedback={feedback}
          feedbackEnabled={feedbackEnabled}
          noteId={noteId}
          noteVersion={noteVersion}
        />

        {readError ? <p className={styles.readError} role="alert">{readError}</p> : null}
      </div>

      <footer className={styles.actionBar}>
        {findings.length ? (
          <nav aria-label="Navegação entre achados" className={styles.bottomNavigator}>
            <button
              disabled={selectedIndex === 0}
              onClick={() => selectFinding(selectedIndex - 1)}
              type="button"
            >
              <Icon name="chevron" /> Anterior
            </button>
            <button
              disabled={selectedIndex === findings.length - 1}
              onClick={() => selectFinding(selectedIndex + 1)}
              type="button"
            >
              Próximo <Icon name="chevron" />
            </button>
          </nav>
        ) : null}
        <button
          className={`${styles.readButton} ${readState === "done" ? styles.readDone : ""}`}
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
      </footer>

      <dialog
        aria-labelledby="mobile-evidence-title"
        className={styles.sheetDialog}
        onClick={closeOnBackdrop}
        ref={evidenceDialog}
      >
        <DialogHeader
          dialogRef={evidenceDialog}
          eyebrow={selectedFinding ? `Achado ${selectedIndex + 1}` : "Evidência"}
          id="mobile-evidence-title"
          title="Onde encontramos"
        />
        <div className={styles.sheetDialogBody}>
          {selectedFinding ? (
            <FindingEvidencePanel
              documentUrl={document.url}
              finding={selectedFinding}
            />
          ) : null}
        </div>
      </dialog>

      <dialog
        aria-labelledby="mobile-document-title"
        className={styles.sheetDialog}
        onClick={closeOnBackdrop}
        ref={documentDialog}
      >
        <DialogHeader
          dialogRef={documentDialog}
          eyebrow="Arquivo original"
          id="mobile-document-title"
          title={`Nota ${number}`}
        />
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

function FindingSummary({
  finding,
  index,
  onOpenEvidence,
}: {
  finding: NoteDetailFinding;
  index: number;
  onOpenEvidence: () => void;
}) {
  const description = humanizeReviewerFindingText(finding.description);
  const explanation = humanizeReviewerFindingText(finding.explanation);
  const labels = findingComparisonLabels(finding);
  const difference = findingComparisonDifference(finding);
  const actual = formatFindingValueLines(
    formatFindingValue(finding.actualValue, "Não informado"),
  ).map(humanizeReviewerFindingText);
  const expected = formatFindingValueLines(
    formatFindingValue(finding.expectedValue, "Sem referência comparável"),
  ).map(humanizeReviewerFindingText);
  const hasMeaningfulComparison =
    finding.expectedValue !== null &&
    finding.actualValue !== null &&
    formatFindingValue(finding.expectedValue) !==
      formatFindingValue(finding.actualValue);
  const showExplanation = reviewerTextIsDistinct(explanation, [description]);
  const evidence = findingEvidence(finding, description, explanation);
  const firstObservation = evidence.observations[0] ?? null;

  return (
    <article className={styles.focusFinding} data-tone={severityTone(finding.severity)}>
      <span className={styles.severityPill}>{mobileSeverityLabel(finding.severity)}</span>
      <div className={styles.focusTitle}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <h1>{humanizeReviewerFindingText(finding.title)}</h1>
      </div>
      <p className={styles.focusDescription}>{description}</p>

      {hasMeaningfulComparison ? (
        <section className={styles.comparison} aria-label="Comparativo do achado">
          <div className={styles.comparisonActual}>
            <h2>{labels.actual}</h2>
            <p>{actual.map((line, lineIndex) => <span key={`${line}-${lineIndex}`}>{line}</span>)}</p>
          </div>
          <div className={styles.comparisonExpected}>
            <h2>{labels.expected}</h2>
            <p>{expected.map((line, lineIndex) => <span key={`${line}-${lineIndex}`}>{line}</span>)}</p>
          </div>
          {difference ? (
            <div className={styles.comparisonDifference}>
              <span>Diferença</span>
              <strong>{difference}</strong>
            </div>
          ) : null}
        </section>
      ) : null}

      {showExplanation ? (
        <section className={styles.attentionReason}>
          <h2>Por que merece atenção</h2>
          <p>{explanation}</p>
        </section>
      ) : null}

      <button className={styles.openEvidence} onClick={onOpenEvidence} type="button">
        <span>
          <Icon name="search" />
          <span>
            <strong>Onde encontramos</strong>
            <small>{evidenceLocationSummary(firstObservation, evidence.observations.length)}</small>
          </span>
        </span>
        <Icon name="chevron" />
      </button>
    </article>
  );
}

function FindingEvidencePanel({
  documentUrl,
  finding,
}: {
  documentUrl: string | null;
  finding: NoteDetailFinding;
}) {
  const description = humanizeReviewerFindingText(finding.description);
  const explanation = humanizeReviewerFindingText(finding.explanation);
  const { evidence, observations, references } = findingEvidence(
    finding,
    description,
    explanation,
  );
  const firstPage = observations.find((observation) => observation.page)?.page ?? null;
  const pageUrl = documentUrl
    ? `${documentUrl.split("#")[0]}${firstPage ? `#page=${firstPage}` : ""}`
    : null;

  return (
    <div className={styles.evidencePanel}>
      <section>
        <h3>Trechos relacionados</h3>
        {observations.length ? (
          <MobileEvidenceObservations
            comparedWith={[description, explanation]}
            observations={observations}
          />
        ) : evidence.length ? (
          <dl className={styles.evidenceList}>
            {evidence.map((part, partIndex) => (
              <div key={`${part.label}:${partIndex}`}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.evidenceEmpty}>
            A localização exata não foi informada. Confira o arquivo original.
          </p>
        )}
      </section>

      {references.length ? (
        <section>
          <h3>Referência usada</h3>
          <ul className={styles.referenceList}>
            {references.map((reference) => <li key={reference}>{reference}</li>)}
          </ul>
        </section>
      ) : null}

      {pageUrl ? (
        <a className={styles.openPageLink} href={pageUrl} rel="noreferrer" target="_blank">
          <Icon name="document" />
          {firstPage ? `Abrir documento na página ${firstPage}` : "Abrir documento original"}
        </a>
      ) : null}
    </div>
  );
}

function DialogHeader({
  dialogRef,
  eyebrow,
  id,
  title,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <header className={styles.dialogHeader}>
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <button aria-label="Fechar" onClick={() => dialogRef.current?.close()} type="button">
        <Icon name="close" />
      </button>
    </header>
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
        const showText = reviewerTextIsDistinct(text, [...comparedWith, label]);

        return (
          <article
            key={`${observation.kind}:${observation.page ?? ""}:${observation.label ?? ""}:${index}`}
          >
            <header>
              <strong>{findingObservationKindLabel(observation.kind)}</strong>
              {observation.page ? <span>Página {observation.page}</span> : null}
            </header>
            <div className={styles.observationMeta}>
              {date ? <span>{date}</span> : null}
              {amount ? <b>{amount}</b> : null}
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
    .filter((part) => reviewerTextIsDistinct(part.value, [description, explanation]));
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

function evidenceLocationSummary(
  firstObservation: FindingEvidenceObservation | null,
  count: number,
) {
  if (!firstObservation) return "Abrir evidências do achado";
  const page = firstObservation.page ? `Página ${firstObservation.page}` : "Trecho extraído";
  return `${page} · ${count} ${count === 1 ? "trecho" : "trechos"}`;
}

function openDialog(ref: RefObject<HTMLDialogElement | null>) {
  if (ref.current && !ref.current.open) ref.current.showModal();
}

function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.currentTarget === event.target) event.currentTarget.close();
}

function isReferenceLabel(value: string) {
  return /refer[eê]ncia|contrato|fonte|se[cç][aã]o|documento usado/i.test(value);
}

function normalizedValue(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function mobileSeverityLabel(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "CRITICAL" || normalized === "HIGH") return "Gravidade alta";
  if (normalized === "INFO" || normalized === "LOW") return "Informativo";
  return "Atenção";
}

function severityTone(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "CRITICAL" || normalized === "HIGH") return "critical";
  if (normalized === "INFO" || normalized === "LOW") return "info";
  return "warning";
}

"use client";

import Link from "next/link";
import type { MouseEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import {
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
import { buildReviewerMobileComparison } from "./reviewer-mobile-comparison";
import {
  extractFindingEvidenceObservations,
  findingEvidenceLocationSummary,
  findingDocumentPageUrl,
  reviewerTextIsDistinct,
} from "./finding-observations";
import { NoteDocumentPreview } from "./note-document-preview";
import styles from "./reviewer-mobile-note-detail.module.css";
import { FindingEvidenceSources } from "./finding-evidence-sources";
import { AnalysisScopeNotice } from "./analysis-scope-notice";
import { useNoteRead } from "./use-note-read";

type ReviewerMobileNoteDetailProps = {
  assurance: { band: "HIGH" | "MEDIUM" | "LIMITED"; reason: string } | null;
  classification: string;
  failureMessage?: string | null;
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
  isRead: boolean;
  number: string;
  supplier: string;
  supplierTaxId: string;
  total: string;
  work: string;
};

export function ReviewerMobileNoteDetail({
  assurance,
  classification,
  failureMessage,
  document,
  feedback,
  feedbackEnabled,
  findings,
  issuedAt,
  items,
  noteId,
  noteVersion,
  isRead,
  number,
  supplier,
  supplierTaxId,
  total,
  work,
}: ReviewerMobileNoteDetailProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { readState, readError, markAsRead } = useNoteRead(noteId, noteVersion, isRead);
  const documentDialog = useRef<HTMLDialogElement>(null);
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const findingHeading = useRef<HTMLHeadingElement>(null);
  const focusRequested = useRef(false);
  const selectedFinding = findings[selectedIndex] ?? null;
  const limitedReview = !assurance || assurance.band === "LIMITED";
  const analysisIsOk = classification === "OK";

  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    findingHeading.current?.focus({ preventScroll: true });
  }, [selectedIndex]);

  function selectFinding(index: number) {
    if (index < 0 || index >= findings.length || index === selectedIndex) return;
    evidenceDialog.current?.close();
    focusRequested.current = true;
    setSelectedIndex(index);
    window.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      top: 0,
    });
  }

  return (
    <section className={styles.mobileDetail} aria-label="Detalhe da nota">
      <header className={styles.appBar}>
        <Link className={styles.iconButton} href="/revisao/notas" aria-label="Voltar para notas">
          <Icon name="chevron" />
        </Link>
        <div className={styles.appBarTitle}>
          <h1>Análise do documento</h1>
          <span>
            {findings.length
              ? `${selectedIndex + 1} de ${findings.length}`
              : failureMessage
                ? "Falha de processamento"
                : analysisIsOk
                  ? "Análise concluída"
                  : limitedReview
                    ? "Revisão manual"
                    : "Análise concluída"}
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
        <section className={styles.documentIdentity} aria-label="Documento em revisão">
          <div><span>Nota {number}</span><strong>{supplier}</strong></div>
          <div><span>Total da nota</span><strong>{total}</strong></div>
        </section>
        <AnalysisScopeNotice assurance={assurance} failureMessage={failureMessage} />
        {failureMessage ? null : selectedFinding ? (
          <FindingSummary
            finding={selectedFinding}
            headingRef={findingHeading}
            index={selectedIndex}
            onOpenEvidence={() => openDialog(evidenceDialog)}
          />
        ) : limitedReview && !analysisIsOk ? (
          <section className={styles.noFindings}>
            <Icon name="document" />
            <div>
              <strong>Revisão manual necessária</strong>
              <p>{assurance?.reason || "A leitura automática não reuniu evidência suficiente para classificar este anexo com segurança."}</p>
            </div>
          </section>
        ) : null}

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

        {!failureMessage ? <AuditFeedbackPanel
          collapsible
          showAssurance={false}
          assurance={assurance}
          currentFeedback={feedback}
          feedbackEnabled={feedbackEnabled}
          noteId={noteId}
          noteVersion={noteVersion}
        /> : null}

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
  headingRef,
  index,
  onOpenEvidence,
}: {
  finding: NoteDetailFinding;
  headingRef: RefObject<HTMLHeadingElement | null>;
  index: number;
  onOpenEvidence: () => void;
}) {
  const description = humanizeReviewerFindingText(finding.description);
  const explanation = humanizeReviewerFindingText(finding.explanation);
  const comparison = buildReviewerMobileComparison(finding);
  const showExplanation = reviewerTextIsDistinct(explanation, [description]);
  const evidence = findingEvidence(finding, description, explanation);

  return (
    <article className={styles.focusFinding} data-tone={severityTone(finding.severity)}>
      <span className={styles.severityPill}>{mobileSeverityLabel(finding.severity)}</span>
      <div className={styles.focusTitle}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <h2 ref={headingRef} tabIndex={-1}>{humanizeReviewerFindingText(finding.title)}</h2>
      </div>
      <p className={styles.focusDescription}>{description}</p>

      {comparison.cards.length ? (
        <section
          aria-label="Comparativo do achado"
          className={styles.comparison}
          data-mode={comparison.mode.toLowerCase()}
        >
          {comparison.cards.map((card, cardIndex) => (
            <div
              className={
                card.tone === "actual"
                  ? styles.comparisonActual
                  : card.tone === "expected"
                    ? styles.comparisonExpected
                    : styles.comparisonNeutral
              }
              key={`${card.label}-${cardIndex}`}
            >
              <h3>{card.label}</h3>
              <p>
                {card.lines.map((line, lineIndex) => (
                  <span key={`${line}-${lineIndex}`}>
                    {humanizeReviewerFindingText(line)}
                  </span>
                ))}
              </p>
            </div>
          ))}
          {comparison.difference ? (
            <div className={styles.comparisonDifference}>
              <span>Diferença</span>
              <strong>{comparison.difference}</strong>
            </div>
          ) : null}
          {comparison.hint ? (
            <p className={styles.comparisonHint}>{comparison.hint}</p>
          ) : null}
        </section>
      ) : null}

      {showExplanation ? (
        <section className={styles.attentionReason}>
          <h3>Por que merece atenção</h3>
          <p>{explanation}</p>
        </section>
      ) : null}

      <button className={styles.openEvidence} onClick={onOpenEvidence} type="button">
        <span>
          <Icon name="search" />
          <span>
            <strong>Onde encontramos</strong>
            <small>{findingEvidenceLocationSummary(evidence.observations)}</small>
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
  const pageUrl = findingDocumentPageUrl(documentUrl, firstPage);

  return (
    <div className={styles.evidencePanel}>
      <section>
        <h3>Trechos relacionados</h3>
        {observations.length ? (
          <FindingEvidenceSources
            documentUrl={documentUrl}
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
          <h3>Fontes citadas</h3>
          <ul className={styles.referenceList}>
            {references.map((reference) => <li key={reference}>{reference}</li>)}
          </ul>
        </section>
      ) : null}

      {pageUrl && observations.length === 0 ? (
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

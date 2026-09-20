"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { beginPwaCriticalActivity } from "@/components/pwa/pwa-critical-activity";

import type { NoteDetailAuditFeedback } from "./data";
import styles from "./audit-feedback-panel.module.css";

const VERDICTS = {
  CORRECT: "Diagnóstico correto",
  FALSE_ALERT: "Alerta indevido",
  MISSED_ISSUE: "Problema não apontado",
  INSUFFICIENT_EVIDENCE: "Evidência insuficiente",
} as const;

const REASONS = {
  CORRECT: {
    DIAGNOSIS_CONFIRMED: "O diagnóstico corresponde ao documento",
    EVIDENCE_CLEAR: "A evidência está clara e localizável",
  },
  FALSE_ALERT: {
    EVIDENCE_DOES_NOT_SUPPORT: "A evidência não sustenta o alerta",
    LEGITIMATE_DIFFERENCE: "A diferença é legítima e está conciliada",
    DUPLICATE_ALERT: "O mesmo problema foi repetido",
  },
  MISSED_ISSUE: {
    MISSING_VALUE_DIVERGENCE: "Faltou divergência de valor",
    MISSING_DATE_DIVERGENCE: "Faltou divergência de data",
    MISSING_DUPLICATE: "Faltou identificar duplicidade",
    MISSING_OTHER: "Faltou outro problema objetivo",
  },
  INSUFFICIENT_EVIDENCE: {
    EVIDENCE_NOT_LOCATABLE: "Não consegui localizar a evidência",
    DOCUMENT_COVERAGE_LIMIT: "A cobertura do documento ficou limitada",
    EXPLANATION_INCOMPLETE: "A explicação não permite conferir o diagnóstico",
  },
} as const;

type Verdict = keyof typeof VERDICTS;

export function AuditFeedbackPanel({
  assurance,
  showAssurance = true,
  collapsible = false,
  currentFeedback,
  feedbackEnabled = true,
  noteId,
  noteVersion,
}: {
  assurance: { band: "HIGH" | "MEDIUM" | "LIMITED"; reason: string } | null;
  showAssurance?: boolean;
  collapsible?: boolean;
  currentFeedback: NoteDetailAuditFeedback | null;
  feedbackEnabled?: boolean;
  noteId: string;
  noteVersion: number;
}) {
  const router = useRouter();
  const initialVerdict = (currentFeedback?.verdict ?? null) as Verdict | null;
  const [verdict, setVerdict] = useState<Verdict | null>(initialVerdict);
  const [reasonCode, setReasonCode] = useState(
    currentFeedback?.reasonCode ?? (initialVerdict ? Object.keys(REASONS[initialVerdict])[0] : ""),
  );
  const [comment, setComment] = useState(currentFeedback?.comment ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = verdict !== initialVerdict || comment !== (currentFeedback?.comment ?? "") ||
    reasonCode !== (currentFeedback?.reasonCode ?? (initialVerdict ? Object.keys(REASONS[initialVerdict])[0] : ""));
  useEffect(() => {
    if (feedbackEnabled && dirty && state !== "saved") return beginPwaCriticalActivity();
  }, [dirty, feedbackEnabled, state]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!verdict || !reasonCode || state === "saving") return;
    setState("saving");
    try {
      const response = await fetch(`/api/notas/${noteId}/audit-feedback`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ comment: comment.trim() || null, noteVersion, reasonCode, verdict }),
      });
      if (!response.ok) throw new Error("Feedback request failed.");
      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  const assuranceLabel = assurance
    ? { HIGH: "Garantia alta", MEDIUM: "Garantia média", LIMITED: "Garantia limitada" }[assurance.band]
    : "Garantia não calculada";

  const content = (
    <div className={collapsible ? styles.collapsibleContent : undefined}>
      {showAssurance ? <div className={styles.assurance}>
        <span className={`${styles.badge} ${assurance ? styles[assurance.band.toLowerCase() as "high" | "medium" | "limited"] : styles.limited}`}>
          {assuranceLabel}
        </span>
        <div>
          <strong>Quanto este diagnóstico pôde ser conferido</strong>
          <p>{assurance?.reason ?? "A auditoria ainda não registrou uma faixa de garantia."}</p>
        </div>
      </div> : null}

      {feedbackEnabled ? <form onSubmit={submit}>
        <fieldset className={styles.form} disabled={state === "saving"}>
          <legend><strong>Este diagnóstico ajudou?</strong></legend>
          <p>Seu retorno melhora a auditoria. Ele não aprova nem rejeita a despesa.</p>
          <div className={styles.choices}>
            {(Object.keys(VERDICTS) as Verdict[]).map((value) => (
              <label className={styles.choice} key={value}>
                <input
                  checked={verdict === value}
                  name="verdict"
                  onChange={() => {
                    setVerdict(value);
                    setReasonCode(Object.keys(REASONS[value])[0]);
                    setState("idle");
                  }}
                  type="radio"
                  required
                  value={value}
                />
                {VERDICTS[value]}
              </label>
            ))}
          </div>
          <label className={styles.field}>
            Motivo
            <select disabled={!verdict} value={reasonCode} onChange={(event) => { setReasonCode(event.target.value); setState("idle"); }}>
              {!verdict ? <option value="">Selecione uma avaliação acima</option> : null}
              {Object.entries(verdict ? REASONS[verdict] : {}).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Comentário {verdict === "MISSED_ISSUE" ? "(obrigatório)" : "(opcional)"}
            <textarea
              maxLength={1_000}
              minLength={verdict === "MISSED_ISSUE" ? 10 : undefined}
              onChange={(event) => { setComment(event.target.value); setState("idle"); }}
              required={verdict === "MISSED_ISSUE"}
              value={comment}
            />
          </label>
          <div className={styles.actions}>
            <button disabled={!verdict || state === "saving"} type="submit">
              {state === "saving" ? "Salvando…" : currentFeedback ? "Atualizar feedback" : "Enviar feedback"}
            </button>
            {state === "saved" ? <p role="status" className={styles.success}>Feedback registrado.</p> : null}
            {state === "error" ? <p role="alert" className={styles.error}>Não foi possível confirmar o salvamento. Confira a conexão e tente novamente; seu texto foi preservado.</p> : null}
          </div>
        </fieldset>
      </form> : null}
    </div>
  );

  if (collapsible) {
    return (
      <details className={`${styles.panel} ${styles.collapsiblePanel}`}>
        <summary className={styles.collapsibleSummary}>
          <span className={styles.summaryIcon} aria-hidden="true">✓</span>
          <span>
            <strong>Feedback sobre o diagnóstico</strong>
            <small>
              {currentFeedback
                ? "Feedback registrado. Abra para consultar ou atualizar."
                : "Opcional — ajude a melhorar a auditoria sem aprovar ou rejeitar a nota."}
            </small>
          </span>
          <span className={styles.summaryAction} aria-hidden="true">⌄</span>
        </summary>
        {content}
      </details>
    );
  }

  return (
    <section className={styles.panel} aria-label="Garantia e feedback da auditoria">
      {content}
    </section>
  );
}

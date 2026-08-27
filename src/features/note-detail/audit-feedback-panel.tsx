"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  currentFeedback,
  feedbackEnabled = true,
  noteId,
  noteVersion,
}: {
  assurance: { band: "HIGH" | "MEDIUM" | "LIMITED"; reason: string } | null;
  currentFeedback: NoteDetailAuditFeedback | null;
  feedbackEnabled?: boolean;
  noteId: string;
  noteVersion: number;
}) {
  const router = useRouter();
  const initialVerdict = (currentFeedback?.verdict ?? "CORRECT") as Verdict;
  const [verdict, setVerdict] = useState<Verdict>(initialVerdict);
  const [reasonCode, setReasonCode] = useState(
    currentFeedback?.reasonCode ?? Object.keys(REASONS[initialVerdict])[0],
  );
  const [comment, setComment] = useState(currentFeedback?.comment ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("saving");
    const response = await fetch(`/api/notas/${noteId}/audit-feedback`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: comment.trim() || null,
        noteVersion,
        reasonCode,
        verdict,
      }),
    });
    if (!response.ok) {
      setState("error");
      return;
    }
    setState("saved");
    router.refresh();
  }

  const assuranceLabel = assurance
    ? { HIGH: "Garantia alta", MEDIUM: "Garantia média", LIMITED: "Garantia limitada" }[assurance.band]
    : "Garantia não calculada";

  return (
    <section className={styles.panel} aria-label="Garantia e feedback da auditoria">
      <div className={styles.assurance}>
        <span className={`${styles.badge} ${assurance ? styles[assurance.band.toLowerCase() as "high" | "medium" | "limited"] : styles.limited}`}>
          {assuranceLabel}
        </span>
        <div>
          <strong>Quanto este diagnóstico pôde ser conferido</strong>
          <p>{assurance?.reason ?? "A auditoria ainda não registrou uma faixa de garantia."}</p>
        </div>
      </div>

      {feedbackEnabled ? <form onSubmit={submit}>
        <fieldset className={styles.form}>
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
                  value={value}
                />
                {VERDICTS[value]}
              </label>
            ))}
          </div>
          <label className={styles.field}>
            Motivo
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
              {Object.entries(REASONS[verdict]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Comentário {verdict === "MISSED_ISSUE" ? "(obrigatório)" : "(opcional)"}
            <textarea
              maxLength={1_000}
              minLength={verdict === "MISSED_ISSUE" ? 10 : undefined}
              onChange={(event) => setComment(event.target.value)}
              required={verdict === "MISSED_ISSUE"}
              value={comment}
            />
          </label>
          <div className={styles.actions}>
            <button disabled={state === "saving"} type="submit">
              {state === "saving" ? "Salvando…" : currentFeedback ? "Atualizar feedback" : "Enviar feedback"}
            </button>
            {state === "saved" ? <p className={styles.success}>Feedback registrado.</p> : null}
            {state === "error" ? <p className={styles.error}>Não foi possível salvar. Atualize e tente novamente.</p> : null}
          </div>
        </fieldset>
      </form> : null}
    </section>
  );
}

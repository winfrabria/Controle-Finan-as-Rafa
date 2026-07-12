"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./ui-icons";
import styles from "./validation-decision-form.module.css";

const suspiciousReasons = [
  "Item não previsto no contrato",
  "Divergência de quantidade",
  "Preço acima da referência",
  "Valor do cupom diferente da nota",
  "Data de emissão inconsistente",
  "Material de uso pessoal ou bebida alcoólica",
  "Documento ou fornecedor não identificado",
  "Outra inconsistência confirmada",
];

const okReasons = [
  "Item previsto ou autorizado para a obra",
  "Quantidade compatível com a medição",
  "Preço compatível com a referência correta",
  "Diferença de valor esclarecida",
  "Data ou documento conferidos",
  "Fornecedor e operação compatíveis",
  "Alerta da IA não se aplica à nota",
  "Outro motivo — detalhar no comentário",
];

export function ValidationDecisionForm({
  isDemo = false,
  noteId,
  onCancel,
}: {
  isDemo?: boolean;
  noteId?: string;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<"OK" | "SUSPEITA" | null>(null);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reasonRequired = decision === "SUSPEITA";
  const reasonOptions = decision === "OK" ? okReasons : suspiciousReasons;
  const reasonLabel =
    decision === "OK"
      ? "Por que a suspeita não procede?"
      : decision === "SUSPEITA"
        ? "Motivo da confirmação"
        : "Motivo da classificação";

  function chooseDecision(nextDecision: "OK" | "SUSPEITA") {
    setDecision(nextDecision);
    setReason("");
    setSaved(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision || (reasonRequired && !reason)) return;
    setError("");
    setSubmitting(true);

    if (isDemo || !noteId) {
      setSaved(true);
      setSubmitting(false);
      window.setTimeout(() => setSaved(false), 3000);
      return;
    }

    try {
      const response = await fetch("/api/validacoes", {
        body: JSON.stringify({ comment, decision, noteId, reason }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        erro?: { mensagem?: string };
      };

      if (!response.ok) {
        throw new Error(
          result.erro?.mensagem ?? "Não foi possível salvar a validação.",
        );
      }

      setSaved(true);
      window.setTimeout(() => router.refresh(), 900);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível salvar a validação.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.validationForm} onSubmit={submit}>
      <fieldset className={styles.decisionGroup}>
        <legend>Sua classificação</legend>
        <div className={styles.decisionOptions}>
          <label
            className={`${styles.decisionOptionCard} ${styles.okOption} ${
              decision === "OK" ? styles.selectedDecision : ""
            }`}
          >
            <input
              type="radio"
              name="decision"
              checked={decision === "OK"}
              onChange={() => chooseDecision("OK")}
              className={styles.srOnly}
              required
            />
            <span className={styles.decisionContent}>
              <span className={styles.decisionIconWrap}>
                <Icon name="check" />
              </span>
              <span className={styles.decisionTexts}>
                <strong>OK</strong>
                <small>Tudo conforme</small>
              </span>
            </span>
          </label>
          <label
            className={`${styles.decisionOptionCard} ${styles.suspiciousOption} ${
              decision === "SUSPEITA" ? styles.selectedDecision : ""
            }`}
          >
            <input
              type="radio"
              name="decision"
              checked={decision === "SUSPEITA"}
              onChange={() => chooseDecision("SUSPEITA")}
              className={styles.srOnly}
              required
            />
            <span className={styles.decisionContent}>
              <span className={styles.decisionIconWrap}>
                <Icon name="warning" />
              </span>
              <span className={styles.decisionTexts}>
                <strong>Suspeita</strong>
                <small>Requer atenção</small>
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <label className={styles.formField}>
        <span className={styles.fieldLabel}>
          {reasonLabel} {reasonRequired ? <b>*</b> : null}
        </span>
        <select
          className={styles.selectControl}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={!decision}
          required={reasonRequired}
        >
          <option value="" disabled>
            {!decision
              ? "Escolha primeiro OK ou Suspeita"
              : decision === "OK"
                ? "Selecione um motivo (opcional)"
                : "Selecione a inconsistência confirmada"}
          </option>
          {reasonOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className={`${styles.formField} ${styles.commentField}`}>
        <span className={styles.fieldLabel}>
          {decision === "SUSPEITA"
            ? "Evidências ou comentário (opcional)"
            : "Comentário (opcional)"}
        </span>
        <span className={styles.textareaWrapper}>
          <textarea
            className={styles.textareaControl}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={
              decision === "OK"
                ? "Se quiser, explique por que a nota está correta..."
                : decision === "SUSPEITA"
                  ? "Registre os pontos que confirmam a inconsistência..."
                  : "Escolha uma classificação e registre sua análise..."
            }
            maxLength={500}
          />
          <small className={styles.counter}>{comment.length}/500</small>
        </span>
      </label>
      <div className={styles.formActions}>
        <button type="button" onClick={onCancel} className={styles.cancelBtn}>
          <Icon name="chevron" /> Voltar para a lista
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={submitting}
        >
          <Icon name={saved ? "check" : "lock"} />
          {saved
            ? "Validação salva"
            : submitting
              ? "Salvando..."
              : "Salvar validação"}
        </button>
      </div>
      <p
        className={`${styles.formStatus} ${error ? styles.formError : ""}`}
        role="status"
        aria-live="polite"
      >
        {saved
          ? `A nota foi validada como ${decision === "OK" ? "OK" : "suspeita"}${isDemo || !noteId ? " nesta demonstração" : ""}.`
          : error}
      </p>
    </form>
  );
}

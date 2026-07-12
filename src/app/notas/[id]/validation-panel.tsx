"use client";

import { FormEvent, useState } from "react";

import styles from "./detail.module.css";

const reasons = [
  "Item não previsto no contrato",
  "Quantidade acima do executado",
  "Preço acima da referência",
  "Divergência entre nota e cupom",
  "Data de emissão inconsistente",
  "Outro motivo",
];

export function ValidationPanel() {
  const [decision, setDecision] = useState("Suspeita");
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(true);
  }
  return (
    <form
      className={`${styles.card} ${styles.validationCard}`}
      onSubmit={submit}
    >
      <header>
        <div>
          <h2>Sua validação</h2>
          <p>Revise a análise da IA e registre sua decisão.</p>
        </div>
      </header>
      <fieldset>
        <legend>Classificação da nota *</legend>
        <label className={decision === "OK" ? styles.choiceActiveOk : ""}>
          <input
            type="radio"
            name="decision"
            value="OK"
            checked={decision === "OK"}
            onChange={(event) => setDecision(event.target.value)}
          />
          <i /> OK
        </label>
        <label className={decision === "Suspeita" ? styles.choiceActive : ""}>
          <input
            type="radio"
            name="decision"
            value="Suspeita"
            checked={decision === "Suspeita"}
            onChange={(event) => setDecision(event.target.value)}
          />
          <i /> Suspeita
        </label>
      </fieldset>
      <label>
        Motivo da classificação *
        <select required defaultValue={reasons[0]}>
          {reasons.map((reason) => (
            <option key={reason}>{reason}</option>
          ))}
        </select>
      </label>
      <label>
        Comentário (opcional)
        <textarea
          maxLength={500}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Descreva os principais pontos da decisão."
        />
        <small>{comment.length}/500</small>
      </label>
      <button type="submit">Salvar validação</button>
      {saved ? (
        <p className={styles.saved} role="status">
          Validação salva nesta demonstração.
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { FormEvent, useState } from "react";

import { Icon } from "./ui-icons";
import styles from "./workspace-ui.module.css";

const reasons = [
  "Item não previsto no contrato",
  "Divergência de quantidade",
  "Preço acima da referência",
  "Valor do cupom diferente da nota",
  "Data de emissão inconsistente",
  "Material de uso pessoal ou bebida alcoólica",
  "Documento ou fornecedor não identificado",
  "Outra inconsistência sugerida pela IA",
];

export function ValidationDecisionForm() {
  const [decision, setDecision] = useState<"OK" | "SUSPEITA">("SUSPEITA");
  const [reason, setReason] = useState(reasons[0]);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  }

  return (
    <form className={styles.validationForm} onSubmit={submit}>
      <fieldset>
        <legend>Sua classificação</legend>
        <label>
          <input
            type="radio"
            name="decision"
            checked={decision === "OK"}
            onChange={() => setDecision("OK")}
          />
          <span>
            <Icon name="check" />
            <strong>OK</strong>
            <small>Tudo conforme</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="decision"
            checked={decision === "SUSPEITA"}
            onChange={() => setDecision("SUSPEITA")}
          />
          <span>
            <Icon name="warning" />
            <strong>Suspeita</strong>
            <small>Requer atenção</small>
          </span>
        </label>
      </fieldset>
      <label>
        Motivo da classificação <b>*</b>
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          {reasons.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Comentário (opcional)
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Descreva os principais pontos que levaram à sua decisão..."
          maxLength={500}
        />
        <small>{comment.length}/500</small>
      </label>
      <button type="submit">
        <Icon name={saved ? "check" : "lock"} />
        {saved ? "Validação salva" : "Salvar validação"}
      </button>
    </form>
  );
}

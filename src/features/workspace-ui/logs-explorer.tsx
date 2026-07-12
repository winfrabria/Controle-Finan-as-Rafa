"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "./ui-icons";
import { StatusBadge } from "./portal-shell";
import styles from "./workspace-ui.module.css";

type LogClassification = "OK" | "Suspeita" | "Incompatível" | "Processamento";

type AuditLog = {
  id: string;
  at: string;
  user: string;
  noteNumber: string;
  action: string;
  classification: LogClassification;
  reason: string;
  work: string;
  status: string;
  comment: string;
};

const logs: AuditLog[] = [
  {
    id: "LOG-20240528-0012487",
    at: "28/05/2024 10:35:42",
    user: "Rafael",
    noteNumber: "00012589",
    action: "Rafael marcou como Suspeita",
    classification: "Suspeita",
    reason: "Divergência de quantidade e/ou valor",
    work: "Projeto Piloto HWN – Alphaville",
    status: "Revisada",
    comment: "A quantidade executada informada está acima do medido em campo.",
  },
  {
    id: "LOG-20240528-0012486",
    at: "28/05/2024 09:18:11",
    user: "Rafael",
    noteNumber: "00012560",
    action: "Rafael marcou como OK",
    classification: "OK",
    reason: "Valores de acordo com contrato",
    work: "Edifício Aurora",
    status: "Revisada",
    comment: "Documento conferido e aprovado.",
  },
  {
    id: "LOG-20240527-0012485",
    at: "27/05/2024 16:43:09",
    user: "Rafael",
    noteNumber: "00012541",
    action: "Rafael manteve a suspeita da IA",
    classification: "Suspeita",
    reason: "Material não previsto no contrato",
    work: "Hospital Central",
    status: "Revisada",
    comment: "Item não consta no contrato vigente da obra.",
  },
  {
    id: "LOG-20240527-0012484",
    at: "27/05/2024 15:42:33",
    user: "Sistema",
    noteNumber: "00012543",
    action: "Nota recebida e processada pela IA",
    classification: "OK",
    reason: "Nenhuma inconsistência material encontrada",
    work: "Hospital Central",
    status: "Processada",
    comment: "Extração concluída com confiança de 98%.",
  },
  {
    id: "LOG-20240527-0012483",
    at: "27/05/2024 14:22:33",
    user: "Sistema",
    noteNumber: "Sem número",
    action: "Leitura automática não concluída",
    classification: "Incompatível",
    reason: "Documento ilegível ou sem campos fiscais suficientes",
    work: "Viaduto Norte",
    status: "Falha de leitura",
    comment: "O arquivo precisa ser reenviado com melhor resolução.",
  },
  {
    id: "LOG-20240526-0012482",
    at: "26/05/2024 11:07:58",
    user: "Sistema",
    noteNumber: "00012510",
    action: "Nota enviada para análise",
    classification: "Processamento",
    reason: "Aguardando extração e aplicação das regras",
    work: "Complexo Industrial",
    status: "Em processamento",
    comment: "Arquivo validado e armazenado com segurança.",
  },
];

function tone(classification: LogClassification) {
  if (classification === "OK") return "ok" as const;
  if (classification === "Incompatível") return "danger" as const;
  if (classification === "Processamento") return "info" as const;
  return "warning" as const;
}

export function LogsExplorer() {
  const [selectedId, setSelectedId] = useState(logs[0].id);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [user, setUser] = useState("");
  const [work, setWork] = useState("");
  const [classification, setClassification] = useState("");
  const [startDate, setStartDate] = useState("2024-05-01");
  const [endDate, setEndDate] = useState("2024-05-31");

  const filtered = useMemo(
    () =>
      logs.filter(
        (log) =>
          (!user || log.user === user) &&
          (!work || log.work === work) &&
          (!classification || log.classification === classification),
      ),
    [classification, user, work],
  );
  const selected =
    filtered.find((log) => log.id === selectedId) ?? filtered[0] ?? logs[0];

  function clearFilters() {
    setUser("");
    setWork("");
    setClassification("");
    setStartDate("2024-05-01");
    setEndDate("2024-05-31");
  }

  function selectLog(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
  }

  return (
    <section className={styles.logsLayout}>
      <article>
        <form className={styles.filterBar} onSubmit={(e) => e.preventDefault()}>
          <fieldset className={styles.periodFieldset}>
            <legend>Período</legend>
            <div>
              <Icon name="calendar" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Data inicial"
              />
              <span>até</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Data final"
              />
            </div>
          </fieldset>
          <label>
            Usuário
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Todos</option>
              <option>Rafael</option>
              <option>Sistema</option>
            </select>
          </label>
          <label>
            Obra
            <select value={work} onChange={(e) => setWork(e.target.value)}>
              <option value="">Todas as obras</option>
              {[...new Set(logs.map((log) => log.work))].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Classificação
            <select
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
            >
              <option value="">Todas</option>
              <option>OK</option>
              <option>Suspeita</option>
              <option>Incompatível</option>
              <option>Processamento</option>
            </select>
          </label>
          <button type="button" onClick={clearFilters}>
            <Icon name="filter" /> Limpar filtros
          </button>
        </form>
        <div className={styles.panel}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Data/hora</th>
                <th>Usuário</th>
                <th>Nº da nota</th>
                <th>Ação</th>
                <th>Classificação</th>
                <th>Motivo</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr
                  key={log.id}
                  className={
                    selected.id === log.id ? styles.selectedTableRow : undefined
                  }
                >
                  <td>{log.at}</td>
                  <td>
                    <span className={styles.miniAvatar}>{log.user[0]}</span>
                    {log.user}
                  </td>
                  <td>
                    <button
                      className={styles.inlineLogButton}
                      type="button"
                      onClick={() => selectLog(log.id)}
                    >
                      {log.noteNumber}
                    </button>
                  </td>
                  <td>{log.action}</td>
                  <td>
                    <StatusBadge tone={tone(log.classification)}>
                      {log.classification}
                    </StatusBadge>
                  </td>
                  <td>{log.reason}</td>
                  <td>{log.status}</td>
                  <td>
                    <button
                      className={styles.eyeButton}
                      type="button"
                      aria-label={`Ver log ${log.id}`}
                      onClick={() => selectLog(log.id)}
                    >
                      <Icon name="eye" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.mobileCardsList}>
            {filtered.map((log) => (
              <button
                type="button"
                onClick={() => selectLog(log.id)}
                className={`${styles.logMobileCard} ${selected.id === log.id ? styles.selectedLog : ""}`}
                key={log.id}
              >
                <strong>{log.at}</strong>
                <span>
                  {log.user}
                  <br />
                  {log.noteNumber}
                </span>
                <StatusBadge tone={tone(log.classification)}>
                  {log.classification}
                </StatusBadge>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
          <footer className={styles.pagination}>
            <span>
              1-{filtered.length} de {logs.length}
            </span>
            <span>Mostrando resultados filtrados</span>
          </footer>
        </div>
      </article>
      <aside
        className={`${styles.panel} ${styles.logDetail}`}
        data-mobile-open={mobileDetailOpen}
      >
        <div className={styles.panelHeader}>
          <h2>Detalhes do log</h2>
          <div className={styles.logDetailActions}>
            <StatusBadge tone={tone(selected.classification)}>
              {selected.classification}
            </StatusBadge>
            <button
              type="button"
              aria-label="Fechar detalhes"
              onClick={() => setMobileDetailOpen(false)}
            >
              ×
            </button>
          </div>
        </div>
        <dl>
          <div>
            <dt>Data/hora</dt>
            <dd>{selected.at}</dd>
          </div>
          <div>
            <dt>Usuário</dt>
            <dd>{selected.user}</dd>
          </div>
          <div>
            <dt>Nº da nota</dt>
            <dd>{selected.noteNumber}</dd>
          </div>
          <div>
            <dt>Obra</dt>
            <dd>{selected.work}</dd>
          </div>
          <div>
            <dt>Ação</dt>
            <dd>{selected.action}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{selected.status}</dd>
          </div>
        </dl>
        <h3>Explicação / comentário</h3>
        <p className={styles.comment}>{selected.comment}</p>
        <h3>Motivo da classificação</h3>
        <p className={styles.comment}>{selected.reason}</p>
        {selected.noteNumber !== "Sem número" ? (
          <Link className={styles.logNoteLink} href="/notas/demo-00012589">
            Abrir detalhe da nota <Icon name="chevron" />
          </Link>
        ) : null}
        <h3>Linha do tempo</h3>
        <ol className={styles.timeline}>
          <li>
            <b>{selected.at}</b>
            {selected.action}
          </li>
          <li>
            <b>Etapa anterior</b>Nota recebida pelo sistema
          </li>
        </ol>
        <small className={styles.logId}>ID do log: {selected.id}</small>
      </aside>
    </section>
  );
}

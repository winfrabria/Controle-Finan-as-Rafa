"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "@/features/workspace-ui/ui-icons";

import type {
  NoteDetailFinding,
  NoteDetailItem,
  NoteDetailSource,
} from "./data";
import {
  formatDecimal,
  jsonSummary,
  severityLabel,
} from "./note-detail-format";
import styles from "./note-detail.module.css";

export function NoteAnalysisExplorer({
  findings,
  items,
  sources,
}: {
  findings: NoteDetailFinding[];
  items: NoteDetailItem[];
  sources: NoteDetailSource[];
}) {
  const [selectedId, setSelectedId] = useState(findings[0]?.id ?? "");
  const selected =
    findings.find((finding) => finding.id === selectedId) ?? findings[0] ?? null;
  const allSources = useMemo(() => {
    const seen = new Set<string>();
    return [...(selected?.sources ?? []), ...sources].filter((source) => {
      const key = `${source.kind}:${source.label}:${source.url ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [selected, sources]);

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

  return (
    <div className={styles.analysisLayout}>
      <aside className={styles.findingsPanel}>
        <h2>{findings.length} apontamentos identificados</h2>
        <p>Selecione um apontamento para ver os detalhes.</p>
        <div className={styles.findingList}>
          {findings.map((finding, index) => (
            <button
              key={finding.id}
              type="button"
              data-active={finding.id === selected.id}
              onClick={() => setSelectedId(finding.id)}
            >
              <span className={styles.findingNumber}>{index + 1}</span>
              <span>
                <strong>{finding.title}</strong>
                <small>{finding.description}</small>
                <small className={styles.severityBadge}>
                  Gravidade: {severityLabel(finding.severity)}
                </small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </aside>

      <article className={styles.findingDetailPanel}>
        <header className={styles.findingDetailTitle}>
          <span className={styles.findingNumber}>
            {findings.findIndex((finding) => finding.id === selected.id) + 1}
          </span>
          <h2>{selected.title}</h2>
          <span className={styles.severityBadge}>
            Gravidade: {severityLabel(selected.severity)}
          </span>
        </header>
        <p className={styles.findingLead}>{selected.description}</p>

        <FindingSection icon="shield" title="Regra aplicada">
          {selected.rule?.description ??
            selected.rule?.name ??
            "Regra de auditoria associada ao apontamento."}
        </FindingSection>
        <FindingSection icon="search" title="O que a IA encontrou">
          {jsonSummary(selected.actualValue, selected.description)}
        </FindingSection>
        <FindingSection icon="document" title="Evidência na nota">
          {jsonSummary(selected.evidence, selected.description)}
        </FindingSection>
        <FindingSection icon="building" title="Referência utilizada">
          {selected.sources.find((source) => source.kind !== "document")?.label ??
            selected.rule?.name ??
            "Parâmetro administrativo vigente para a obra."}
        </FindingSection>

        <section className={styles.comparison}>
          <div>
            <h3>Esperado (referência)</h3>
            <p>{jsonSummary(selected.expectedValue)}</p>
            <span>Valor esperado</span>
          </div>
          <div>
            <h3>Identificado (na nota)</h3>
            <p>{jsonSummary(selected.actualValue)}</p>
          </div>
        </section>

        <section className={styles.affectedItems}>
          <h3>Itens afetados</h3>
          <table className={styles.evidenceTable}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição do produto / serviço</th>
                <th>UN</th>
                <th>QTD.</th>
                <th>Vlr. unit.</th>
                <th>Vlr. total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{affectedItem?.code ?? selected.affectedItem?.code ?? "—"}</td>
                <td>
                  {affectedItem?.description ??
                    selected.affectedItem?.description ??
                    "Item geral da nota"}
                </td>
                <td>{affectedItem?.unit ?? "—"}</td>
                <td>{formatDecimal(affectedItem?.quantity ?? null, 0)}</td>
                <td>{formatDecimal(affectedItem?.unitPrice ?? null)}</td>
                <td>{formatDecimal(affectedItem?.totalAmount ?? null)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className={styles.justification}>
          <h3>Justificativa</h3>
          <p>{selected.rule?.description ?? selected.description}</p>
        </section>
      </article>

      <aside className={styles.analysisAside}>
        <section>
          <h2>Trecho da DANFE (evidência)</h2>
          <p>Exibição do item relacionado ao apontamento selecionado.</p>
          <div className={styles.danfeExcerpt}>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>UN</th>
                  <th>QTD.</th>
                  <th>Vlr. unit.</th>
                  <th>Vlr. total</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 6).map((item) => (
                  <tr
                    key={item.id}
                    data-highlight={item.id === selected.affectedItem?.id}
                  >
                    <td>{item.code ?? "—"}</td>
                    <td>{item.description}</td>
                    <td>{item.unit ?? "—"}</td>
                    <td>{formatDecimal(item.quantity, 0)}</td>
                    <td>{formatDecimal(item.unitPrice)}</td>
                    <td>{formatDecimal(item.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Fontes consultadas</h2>
          <ul className={styles.sourceList}>
            {allSources.slice(0, 6).map((source) => (
              <li key={`${source.kind}:${source.label}:${source.url ?? ""}`}>
                <Icon name="document" />
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                ) : (
                  <span>{source.label}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Limitações da análise</h2>
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
              A IA não substitui a análise humana; a decisão final pertence ao revisor.
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function FindingSection({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: "building" | "document" | "search" | "shield";
  title: string;
}) {
  return (
    <section className={styles.findingSection}>
      <Icon name={icon} />
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </section>
  );
}

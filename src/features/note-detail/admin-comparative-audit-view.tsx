import Link from "next/link";

import { PortalShell, StatusBadge } from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  auditResultLabel,
  auditResultTone,
} from "@/features/workspace-ui/audit-result-label";
import type { Prisma } from "@/generated/prisma/client";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";

import type { AdminNoteDetail, AdminNoteDetailFinding } from "./data";
import { AdminAuditActions } from "./admin-audit-actions";
import styles from "./admin-comparative-audit.module.css";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDecimal,
  jsonSummary,
} from "./note-detail-format";
import { NoteDocumentPreview } from "./note-document-preview";

type Props = {
  data: AdminNoteDetail;
  documentUrl: string | null;
  userEmail: string;
};

export function AdminComparativeAuditView({
  data,
  documentUrl,
  userEmail,
}: Props) {
  const raw = data.analysis.rawExtraction;
  const latestValidation = data.validations.at(-1) ?? null;
  const latestRun = data.technical.aiRuns[0] ?? null;
  const number = attachmentReference(data.number, data.id);
  const series = rawValue(raw, ["serie", "series"]) ?? "Não identificada";
  const supplier = data.supplier.name ?? "Fornecedor não identificado";
  const total = formatCurrency(data.totalAmount);
  const rawClassification = auditResultLabel(
    data.analysis.auditResult,
    data.analysis.classification,
    data.status,
  );
  const classification =
    rawClassification === "Suspeita" && data.analysis.findings.length === 0
      ? "Análise incompleta"
      : rawClassification;
  const fields = [
    ["Número da nota", number],
    ["Série", series],
    ["Data da emissão", formatDate(data.issuedAt)],
    ["CNPJ do fornecedor", data.supplier.taxId ?? "Não identificado"],
    ["Inscrição estadual", rawValue(raw, ["inscricaoEstadual", "stateRegistration"]) ?? "Não identificada"],
    ["Tipo de operação", rawValue(raw, ["tipoOperacao", "operationType"]) ?? "Não identificado"],
    ["Natureza da operação", rawValue(raw, ["naturezaOperacao", "operationNature"]) ?? "Não identificada"],
    ["Valor total dos produtos", formatMaybeCurrency(rawValue(raw, ["valorProdutos", "productsTotal"]), total)],
    ["Valor total da nota", total],
    ["Base de cálculo ICMS", formatMaybeCurrency(rawValue(raw, ["baseCalculoIcms", "icmsBase"]))],
    ["Valor do ICMS", formatMaybeCurrency(rawValue(raw, ["valorIcms", "icmsValue"]))],
  ];

  return (
    <PortalShell active="notas" role="admin" userEmail={userEmail}>
      <main className={styles.auditPage}>
        <nav className={styles.breadcrumb} aria-label="Navegação estrutural">
          <Link href="/admin/notas">Notas</Link>
          <Icon name="chevron" />
          <strong>Detalhe da nota</strong>
        </nav>

        <header className={styles.pageHeader}>
          <div>
            <div className={styles.titleRow}>
              <h1>Auditoria comparativa</h1>
              <StatusBadge tone={auditResultTone(classification)}>
                ● &nbsp;{classification}
              </StatusBadge>
              {data.demoLabel ? <span className={styles.demoBadge}>{data.demoLabel}</span> : null}
            </div>
            <p>Rastreabilidade completa: extração por IA, validações e decisão humana.</p>
          </div>
          <AdminAuditActions
            isDemo={data.isDemo}
            latestRun={latestRun}
            noteId={data.id}
          />
        </header>

        <section className={styles.metadataStrip} aria-label="Resumo da nota">
          <Metadata icon="document" label="Obra" value={data.work.name} />
          <Metadata icon="help" label="Fornecedor" value={supplier} />
          <Metadata icon="document" label="Número da nota" value={number} />
          <Metadata icon="document" label="Série" value={series} orange />
          <Metadata icon="calendar" label="Data da emissão" value={formatDate(data.issuedAt)} />
          <Metadata icon="money" label="Valor total da nota" value={total} green />
        </section>

        <div className={styles.auditGrid}>
          <section className={`${styles.panel} ${styles.documentPanel}`}>
            <header className={styles.panelHeader}>
              <h2>1. Documento original (DANFE)</h2>
              {documentUrl ? <a href={documentUrl} target="_blank" rel="noreferrer">Abrir em nova aba ↗</a> : null}
            </header>
            <NoteDocumentPreview
              documentUrl={documentUrl}
              fileName={data.document.fileName}
              isImage={data.document.mimeType.startsWith("image/")}
              items={data.items}
              number={number}
              supplier={supplier}
              total={total}
            />
          </section>

          <section className={`${styles.panel} ${styles.extractionPanel}`}>
            <header className={styles.panelHeader}>
              <div>
                <h2>2. Extração estruturada (IA)</h2>
                <p>Dados extraídos e normalizados da nota fiscal.</p>
              </div>
              <span className={styles.successPill}><Icon name="check" /> Extração concluída</span>
            </header>
            <dl className={styles.extractedFields}>
              {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <h3>Itens extraídos ({data.items.length})</h3>
            <ItemsTable data={data} />
            <footer className={styles.extractionFooter}>
              <span>Confiança média da extração: <strong>{formatConfidence(data.analysis.readConfidence)}</strong></span>
              <Link href={`/notas/${data.id}/analise-ia`}>Ver todos os campos extraídos <Icon name="chevron" /></Link>
            </footer>
          </section>

          <aside className={styles.rightColumn}>
            <section className={`${styles.panel} ${styles.findingsPanel}`}>
              <header className={styles.panelHeader}>
                <div><h2>3. Achados da IA</h2><p>{data.analysis.findings.length} divergência(s) identificada(s)</p></div>
              </header>
              <div className={styles.findingList}>
                {data.analysis.findings.length ? data.analysis.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />) : (
                  <p className={styles.emptyState}><Icon name="check" /> Nenhuma divergência identificada.</p>
                )}
              </div>
            </section>

            <section className={`${styles.panel} ${styles.decisionPanel}`}>
              <header className={styles.decisionHeader}>
                <h2>4. Decisão humana (mais recente)</h2>
                {latestValidation ? <StatusBadge tone={validationTone(latestValidation.decision)}>{validationLabel(latestValidation.decision)}</StatusBadge> : null}
              </header>
              {latestValidation ? (
                <dl>
                  <div><dt>Decidido por</dt><dd>{latestValidation.validator.fullName ?? latestValidation.validator.email}</dd></div>
                  <div><dt>Perfil</dt><dd>Revisor financeiro</dd></div>
                  <div><dt>Data da decisão</dt><dd>{formatDateTime(latestValidation.createdAt)}</dd></div>
                  <div className={styles.fullRow}><dt>Motivo da classificação</dt><dd>{latestValidation.reason}</dd></div>
                  {latestValidation.comment ? <div className={styles.fullRow}><dt>Comentário</dt><dd>{latestValidation.comment}</dd></div> : null}
                </dl>
              ) : <p className={styles.noDecision}>Nenhuma decisão humana registrada.</p>}
            </section>
          </aside>
        </div>

        <section className={`${styles.panel} ${styles.timelinePanel}`}>
          <header><h2>5. Linha do tempo de eventos</h2></header>
          <ol>
            {data.history.map((entry, index) => (
              <li key={entry.id}>
                <span className={styles.timelineIcon}><Icon name={timelineIcon(entry.type)} /></span>
                <time>{formatDateTime(entry.createdAt)}</time>
                <small>{entry.actor?.fullName ?? entry.actor?.email ?? "Sistema"}</small>
                <strong>{entry.label}</strong>
                <p>{timelineDescription(entry)}</p>
                {index < data.history.length - 1 ? <i /> : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </PortalShell>
  );
}

function Metadata({ icon, label, value, green = false, orange = false }: { icon: "calendar" | "document" | "help" | "money"; label: string; value: string; green?: boolean; orange?: boolean }) {
  return <div><span className={green ? styles.greenIcon : orange ? styles.orangeIcon : styles.blueIcon}><Icon name={icon} /></span><dl><dt>{label}</dt><dd>{value}</dd></dl></div>;
}

function ItemsTable({ data }: { data: AdminNoteDetail }) {
  return <div className={styles.itemsWrap}><table><thead><tr><th>Código</th><th>Descrição</th><th>NCM/SH</th><th>UN</th><th>Qtd.</th><th>Vlr. unit.</th><th>Vlr. total</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td>{item.code ?? "—"}</td><td>{item.description}</td><td>{rawItemValue(item.rawData, ["ncm", "ncmSh"]) ?? "—"}</td><td>{item.unit ?? "—"}</td><td>{formatDecimal(item.quantity, 0)}</td><td>{formatDecimal(item.unitPrice)}</td><td>{formatDecimal(item.totalAmount)}</td></tr>)}</tbody></table><div className={styles.itemCards}>{data.items.map((item) => <article key={item.id}><strong>{item.description}</strong><span>{item.code ?? "Sem código"}</span><dl><div><dt>Quantidade</dt><dd>{formatDecimal(item.quantity, 0)} {item.unit ?? ""}</dd></div><div><dt>Valor unitário</dt><dd>{formatDecimal(item.unitPrice)}</dd></div><div><dt>Total</dt><dd>{formatDecimal(item.totalAmount)}</dd></div></dl></article>)}</div></div>;
}

function FindingCard({ finding }: { finding: AdminNoteDetailFinding }) {
  return <article><header><Icon name="warning" /><div><span>Regra</span><strong>{finding.title}</strong></div><dl><dt>Confiança</dt><dd>{formatConfidence(finding.confidence)}</dd></dl></header><div><span>Evidência</span><p>{jsonSummary(finding.evidence, finding.description)}</p></div><footer><dl><div><dt>Esperado</dt><dd>{jsonSummary(finding.expectedValue, "Conforme regra")}</dd></div><div><dt>Extraído</dt><dd>{jsonSummary(finding.actualValue, "Não informado")}</dd></div><div><dt>Impacto</dt><dd>{severityLabel(finding.severity)}</dd></div></dl></footer><details><summary>Justificativa e rastreabilidade</summary><p>{finding.justification}</p><small>{sourceLabel(finding.source)} · Regra {finding.ruleVersion ?? "sem versão"}</small></details></article>;
}

function rawValue(value: Prisma.JsonValue | null, keys: string[]) { if (!value || Array.isArray(value) || typeof value !== "object") return null; for (const key of keys) { const entry = value[key]; if (typeof entry === "string" || typeof entry === "number") return String(entry); } return null; }
function rawItemValue(value: Prisma.JsonValue | null, keys: string[]) { return rawValue(value, keys); }
function formatMaybeCurrency(value: string | null, fallback = "Não identificado") { return value ? formatCurrency(value) : fallback; }
function formatConfidence(value: number | null) { return value === null ? "Não informada" : `${Math.round(value * 100)}%`; }
function validationLabel(value: string) { return value === "SUSPICION_CONFIRMED" || value === "FINDING_CORRECT" ? "Suspeita" : "OK"; }
function validationTone(value: string): "ok" | "warning" { return value === "SUSPICION_CONFIRMED" || value === "FINDING_CORRECT" ? "warning" : "ok"; }
function severityLabel(value: string) { return value === "CRITICAL" ? "Alto" : value === "WARNING" ? "Médio" : "Baixo"; }
function sourceLabel(value: string) { return value === "WORK_RULE" ? "Regra da obra" : value === "AI_DISCOVERY" ? "Descoberta da IA" : "Regra universal"; }
function timelineIcon(type: string): "document" | "money" | "warning" | "help" { return type.includes("VALIDATION") ? "help" : type.includes("ANALYSIS") ? "warning" : type.includes("EXTRACTION") ? "money" : "document"; }
function timelineDescription(entry: AdminNoteDetail["history"][number]) {
  const descriptions: Record<string, string> = {
    AUDIT_COMPLETED: "As regras e a análise da IA foram concluídas.",
    ANALYSIS_COMPLETED: "O diagnóstico final do anexo foi registrado.",
    EXTRACTION_COMPLETED: "Os dados e itens identificados foram normalizados para auditoria.",
    EXTRACTION_FAILED: "A tentativa de leitura falhou e ficou disponível para diagnóstico.",
    EXTRACTION_STARTED: "O Harness iniciou a leitura estruturada dos dados e itens.",
    FILE_STORED: "O arquivo original foi salvo com segurança e liberado para leitura.",
    NOTE_RECEIVED: "O anexo foi recebido e colocado na fila de processamento.",
    PROCESSING_STARTED: "O processamento do anexo foi iniciado.",
    READ_FAILED: "Não foi possível obter dados mínimos confiáveis para auditar o anexo.",
    REPROCESS_SCHEDULED: "Uma nova leitura e auditoria foram colocadas na fila.",
    UPLOAD_FAILED: "O recebimento do arquivo não foi concluído.",
    UPLOAD_RECEIVED: "O anexo foi recebido e colocado na fila de processamento.",
    VALIDATION_RECORDED: "A decisão humana foi registrada no histórico.",
  };
  return descriptions[entry.type] ?? "Evento registrado no sistema.";
}

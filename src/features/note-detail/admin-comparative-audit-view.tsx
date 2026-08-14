import Link from "next/link";

import { PortalShell, StatusBadge } from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  auditResultLabel,
  auditResultTone,
} from "@/features/workspace-ui/audit-result-label";
import type { Prisma } from "@/generated/prisma/client";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";
import {
  formatFindingParts,
  formatFindingValue,
  humanizeFindingText,
} from "@/features/internal-notes/finding-display";

import type { AdminNoteDetail, AdminNoteDetailFinding } from "./data";
import { AdminAuditActions } from "./admin-audit-actions";
import styles from "./admin-comparative-audit.module.css";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDecimal,
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
  const timelineEntries = buildTimelineEntries(data);
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
              isDemo={data.isDemo}
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
          <header>
            <h2>5. Como o Harness processou este anexo</h2>
            <p>Eventos, modelos, versões e critérios registrados em ordem cronológica.</p>
          </header>
          <ol>
            {timelineEntries.map((entry, index) => (
              <li key={entry.id}>
                <span className={styles.timelineIcon}><Icon name={entry.icon} /></span>
                <time>{formatDateTime(entry.createdAt)}</time>
                <small>{entry.actor}</small>
                <strong>{entry.label}</strong>
                <p>{entry.description}</p>
                {entry.href ? <Link className={styles.timelineLink} href={entry.href}>Abrir log completo</Link> : null}
                {index < timelineEntries.length - 1 ? <i /> : null}
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
  const hiddenEvidenceLabels = new Set([
    "Base da conciliação",
    "Código da regra",
    "Tolerância",
  ]);
  const evidence = formatFindingParts(finding.evidence).filter(
    (part) => !hiddenEvidenceLabels.has(part.label),
  );
  return (
    <article className={styles.findingCard}>
      <header className={styles.findingHeader}>
        <Icon name="warning" />
        <div>
          <span>{sourceLabel(finding.source)}</span>
          <strong>{humanizeFindingText(finding.title)}</strong>
          <p>{humanizeFindingText(finding.description)}</p>
        </div>
        <StatusBadge tone="warning">{severityLabel(finding.severity)}</StatusBadge>
      </header>
      {evidence.length ? (
        <section className={styles.findingEvidence}>
          <h3>Evidência no documento</h3>
          <dl className={styles.evidenceGrid}>
            {evidence.slice(0, 6).map((part, index) => (
              <div key={`${part.label}-${index}`}>
                <dt>{part.label}</dt>
                <dd>{humanizeFindingText(part.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <section className={styles.findingReason}>
        <h3>Por que merece atenção</h3>
        <p>{humanizeFindingText(finding.justification)}</p>
      </section>
      <footer className={styles.findingFooter}>
        <dl className={styles.comparisonGrid}>
          <div><dt>Esperado</dt><dd>{formatFindingValue(finding.expectedValue, "Conforme o documento")}</dd></div>
          <div><dt>Encontrado</dt><dd>{formatFindingValue(finding.actualValue, "Não informado")}</dd></div>
        </dl>
      </footer>
      <details className={styles.findingTrace}>
        <summary>Rastreabilidade técnica</summary>
        <p>Confiança: {formatConfidence(finding.confidence)}</p>
        <small>Regra {finding.ruleVersion ?? "sem versão"}</small>
      </details>
    </article>
  );
}

function rawValue(value: Prisma.JsonValue | null, keys: string[]) { if (!value || Array.isArray(value) || typeof value !== "object") return null; for (const key of keys) { const entry = value[key]; if (typeof entry === "string" || typeof entry === "number") return String(entry); } return null; }
function rawItemValue(value: Prisma.JsonValue | null, keys: string[]) { return rawValue(value, keys); }
function formatMaybeCurrency(value: string | null, fallback = "Não identificado") { return value ? formatCurrency(value) : fallback; }
function formatConfidence(value: number | null) { return value === null ? "Não informada" : `${Math.round(value * 100)}%`; }
function validationLabel(value: string) { return value === "SUSPICION_CONFIRMED" || value === "FINDING_CORRECT" ? "Suspeita" : "OK"; }
function validationTone(value: string): "ok" | "warning" { return value === "SUSPICION_CONFIRMED" || value === "FINDING_CORRECT" ? "warning" : "ok"; }
function severityLabel(value: string) { return value === "CRITICAL" ? "Alto" : value === "WARNING" ? "Médio" : "Baixo"; }
function sourceLabel(value: string) { return value === "WORK_RULE" ? "Regra da obra" : value === "AI_DISCOVERY" ? "Descoberta da IA" : "Regra universal"; }
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

function buildTimelineEntries(data: AdminNoteDetail) {
  const events = data.history.map((entry) => ({
    actor: entry.actor?.fullName ?? entry.actor?.email ?? "Sistema",
    createdAt: entry.createdAt,
    description: timelineDescription(entry),
    href: null as string | null,
    icon: timelineIcon(entry.type),
    id: `event-${entry.id}`,
    label: entry.label,
  }));
  const runs = data.technical.aiRuns.map((run) => ({
    actor: "Harness",
    createdAt: run.createdAt,
    description:
      run.kind === "EXTRACTION"
        ? `Leitura estruturada com ${run.model}. Prompt ${run.promptVersion ?? "não informado"}, schema ${run.schemaVersion ?? "não informado"} e ${run.attempts} tentativa(s). ${runCoverageSummary(run.structuredResponse)}`
        : `Política ${run.policyVersion} aplicada por ${run.model} com esforço ${run.reasoningEffort}. ${run.status === "SUCCEEDED" ? "A resposta foi validada e persistida." : `A execução terminou como ${run.status}${run.errorCode ? ` (${run.errorCode})` : ""}.`} ${runCriteriaSummary(run.structuredResponse)}`,
    href: `/admin/logs/AI-${run.id}`,
    icon: run.kind === "EXTRACTION" ? "money" as const : "warning" as const,
    id: `run-${run.id}`,
    label: run.kind === "EXTRACTION" ? "Execução da leitura da IA" : "Execução da auditoria do Harness",
  }));
  return [...events, ...runs].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function runCriteriaSummary(value: Prisma.JsonValue | null | undefined) {
  const response = jsonRecord(value);
  const codes = response && Array.isArray(response.findingCodes)
    ? response.findingCodes.filter((code): code is string => typeof code === "string")
    : [];
  if (codes.length === 0) return "Nenhum critério produziu achado nessa execução.";
  return `Critérios acionados: ${codes.map(humanizeFindingText).join(", ")}.`;
}

function runCoverageSummary(value: Prisma.JsonValue | null | undefined) {
  const response = jsonRecord(value);
  const coverage = response ? jsonRecord(response.itemCoverage) : null;
  if (!coverage || typeof coverage.status !== "string") {
    return "A cobertura da tabela de itens não foi comprovada.";
  }
  if (coverage.status === "COMPLETE") {
    return "A camada de itens usada na conciliação foi registrada como completa.";
  }
  if (coverage.status === "INCOMPLETE") {
    return "A extração registrou cobertura incompleta; diferenças do total não são concluídas com essa soma parcial.";
  }
  return "A cobertura da tabela de itens permaneceu desconhecida.";
}

function timelineIcon(type: string): "document" | "money" | "warning" | "help" {
  return type.includes("VALIDATION")
    ? "help"
    : type.includes("ANALYSIS") || type.includes("AUDIT")
      ? "warning"
      : type.includes("EXTRACTION")
        ? "money"
        : "document";
}

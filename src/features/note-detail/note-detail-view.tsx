import Link from "next/link";

import {
  PortalShell,
  StatusBadge,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";
import {
  auditResultLabel,
  auditResultTone,
} from "@/features/workspace-ui/audit-result-label";
import type { Prisma } from "@/generated/prisma/client";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";

import type { NoteDetailData } from "./data";
import { AdminComparativeAuditView } from "./admin-comparative-audit-view";
import { NoteDetailActions } from "./note-detail-actions";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDecimal,
  jsonSummary,
} from "./note-detail-format";
import styles from "./note-detail.module.css";
import { NoteDocumentPreview } from "./note-document-preview";

type NoteDetailViewProps = {
  data: NoteDetailData;
  documentUrl: string | null;
  userEmail: string;
};

export function NoteDetailView({
  data,
  documentUrl,
  userEmail,
}: NoteDetailViewProps) {
  if (data.viewerRole === "ADMIN") {
    return (
      <AdminComparativeAuditView
        data={data}
        documentUrl={documentUrl}
        userEmail={userEmail}
      />
    );
  }

  const role: PortalRole = "reviewer";
  const basePath = "/revisao";
  const classification = auditResultLabel(
    data.analysis.auditResult,
    data.analysis.classification,
    data.status,
  );
  const primaryFinding = data.analysis.findings[0] ?? null;
  const latestValidation = data.validations.at(-1) ?? null;
  const raw = data.analysis.rawExtraction;
  const number = attachmentReference(data.number, data.id);
  const supplier = data.supplier.name ?? "Fornecedor não identificado";
  const total = formatCurrency(data.totalAmount);
  const extractedFields = [
    ["Número da nota", number, "document"],
    ["Série", rawValue(raw, ["serie", "series"]) ?? "Não identificada", "document"],
    [
      "Tipo de operação",
      rawValue(raw, ["tipoOperacao", "operationType"]) ?? "Não identificado",
      "building",
    ],
    [
      "Natureza da operação",
      rawValue(raw, ["naturezaOperacao", "operationNature"]) ??
        "Não identificada",
      "building",
    ],
    ["CNPJ do fornecedor", data.supplier.taxId ?? "Não identificado", "document"],
    [
      "Inscrição estadual",
      rawValue(raw, ["inscricaoEstadual", "stateRegistration"]) ??
        "Não identificada",
      "document",
    ],
    [
      "CNPJ do destinatário",
      rawValue(raw, ["destinatarioTaxId", "recipientTaxId"]) ??
        "Não identificado",
      "document",
    ],
    ["Data de emissão", formatDate(data.issuedAt), "calendar"],
    [
      "Valor total dos produtos",
      rawValue(raw, ["valorProdutos", "productsTotal"])
        ? formatCurrency(rawValue(raw, ["valorProdutos", "productsTotal"]))
        : total,
      "money",
    ],
    ["Valor total da nota", total, "money"],
    [
      "Base de cálculo ICMS",
      formatMaybeCurrency(rawValue(raw, ["baseCalculoIcms", "icmsBase"])),
      "money",
    ],
    [
      "Valor do ICMS",
      formatMaybeCurrency(rawValue(raw, ["valorIcms", "icmsValue"])),
      "money",
    ],
  ] as const;

  return (
    <PortalShell active="notas" role={role} userEmail={userEmail}>
      <div className={styles.detailPage}>
        <nav className={styles.breadcrumb} aria-label="Navegação estrutural">
          <Link href={`${basePath}/notas`}>Notas</Link>
          <Icon name="chevron" />
          <strong>Detalhe da nota</strong>
        </nav>

        <header className={styles.pageHeader}>
          <div>
            <div className={styles.titleRow}>
              <h1>Detalhe da nota</h1>
              <StatusBadge tone={auditResultTone(classification)}>
                ● &nbsp;{classification}
              </StatusBadge>
              {data.demoLabel ? (
                <span className={styles.demoBadge}>{data.demoLabel}</span>
              ) : null}
            </div>
            <p>Análise completa da nota fiscal eletrônica.</p>
          </div>
          <NoteDetailActions />
        </header>

        <section className={styles.metadataStrip} aria-label="Resumo da nota">
          <MetadataItem icon="document" label="Obra" value={data.work.name} />
          <MetadataItem icon="help" label="Fornecedor" value={supplier} />
          <MetadataItem
            icon="calendar"
            label="Data da emissão"
            value={formatDate(data.issuedAt)}
          />
          <MetadataItem icon="money" label="Valor da nota (R$)" value={total} green />
        </section>

        <div className={styles.detailGrid}>
          <section className={`${styles.card} ${styles.documentCard}`}>
            <header className={styles.cardHeader}>
              <h2>Documento em foco (DANFE)</h2>
              {documentUrl ? (
                <a href={documentUrl} target="_blank" rel="noreferrer">
                  Abrir em nova aba ↗
                </a>
              ) : null}
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

          <section className={`${styles.card} ${styles.extractedCard}`}>
            <header className={styles.cardHeader}>
              <div>
                <h2>Dados extraídos</h2>
                <p>Campos identificados na nota fiscal eletrônica.</p>
              </div>
            </header>
            <dl className={styles.extractedGrid}>
              {extractedFields.map(([label, value, icon]) => (
                <div key={label}>
                  <span className={styles.fieldIcon}>
                    <Icon name={icon} />
                  </span>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <aside className={styles.reviewColumn}>
            <section className={`${styles.card} ${styles.aiSummaryCard}`}>
              <header className={styles.cardHeader}>
                <div>
                  <h2>Explicação da IA</h2>
                  <p>
                    {classification === "Suspeita"
                      ? "Principais pontos que levaram à classificação do anexo como suspeito."
                      : "Resultado e evidências registradas no processamento deste anexo."}
                  </p>
                </div>
              </header>
              {primaryFinding ? (
                <div className={styles.primaryFinding}>
                  <div className={styles.findingTitle}>
                    <Icon name="warning" />
                    <strong>1. {primaryFinding.title}</strong>
                  </div>
                  <h3>Evidência</h3>
                  <p>{jsonSummary(primaryFinding.evidence, primaryFinding.description)}</p>
                  <h3>Justificativa</h3>
                  <p>
                    {primaryFinding.rule?.description ?? primaryFinding.description}
                  </p>
                </div>
              ) : (
                <div className={styles.emptyFinding}>
                  <Icon name="check" /> Nenhum apontamento identificado.
                </div>
              )}
              {data.analysis.findings.length > 1 ? (
                <span className={styles.moreFindings}>
                  +{data.analysis.findings.length - 1} outros apontamentos
                </span>
              ) : null}
              <Link className={styles.analysisLink} href={`/notas/${data.id}/analise-ia`}>
                Ver análise completa da IA <Icon name="chevron" />
              </Link>
            </section>

        <section className={`${styles.card} ${styles.validationCard}`}>
              <header className={styles.cardHeader}>
                <div>
                  <h2>Leitura do diagnóstico</h2>
                  <p>Consulte o resultado da IA nesta tela. Decisões humanas ficam fora do MVP.</p>
                </div>
              </header>
              <div className={styles.validationBody}>
                {latestValidation ? (
                  <dl className={styles.validationResult}>
                    <div>
                      <dt>Decisão</dt>
                      <dd>{validationDecisionLabel(latestValidation.decision)}</dd>
                    </div>
                    <div>
                      <dt>Motivo</dt>
                      <dd>{latestValidation.reason}</dd>
                    </div>
                    <div>
                      <dt>Responsável</dt>
                      <dd>{latestValidation.validator.fullName ?? latestValidation.validator.email}</dd>
                    </div>
                    {latestValidation.comment ? (
                      <div>
                        <dt>Comentário</dt>
                        <dd>{latestValidation.comment}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : <p className={styles.pendingMessage}>Nenhuma decisão humana registrada.</p>}
              </div>
            </section>
          </aside>
        </div>

        <section className={`${styles.card} ${styles.itemsCard}`}>
          <header className={styles.itemsHeader}>
            <div>
              <h2>Itens da nota</h2>
              <p>Produtos e serviços identificados no documento fiscal.</p>
            </div>
            <dl>
              <div><dt>Total de itens</dt><dd>{data.items.length}</dd></div>
              <div><dt>Valor total</dt><dd>{total}</dd></div>
            </dl>
          </header>
          <div className={styles.itemsTableWrap}>
            <table>
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
                {data.items.map((item) => (
                  <tr key={item.id}>
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
          <div className={styles.itemCards}>
            {data.items.map((item) => (
              <article key={item.id}>
                <header>
                  <span>{item.code ?? "Sem código"}</span>
                  <strong>{formatDecimal(item.totalAmount)}</strong>
                </header>
                <h3>{item.description}</h3>
                <dl>
                  <div><dt>Unidade</dt><dd>{item.unit ?? "—"}</dd></div>
                  <div><dt>Quantidade</dt><dd>{formatDecimal(item.quantity, 0)}</dd></div>
                  <div><dt>Valor unitário</dt><dd>{formatDecimal(item.unitPrice)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className={`${styles.card} ${styles.timelineCard}`}>
          <header>
            <h2>Histórico da nota</h2>
            <p>Acompanhe todas as ações realizadas nesta nota.</p>
          </header>
          <ol>
            {data.history.slice(-5).map((entry, index) => (
              <li key={entry.id}>
                <span className={styles.timelineIcon}>
                  <Icon
                    name={
                      entry.type.includes("VALIDATION")
                        ? "help"
                        : entry.type.includes("ANALYSIS")
                          ? "warning"
                          : entry.type.includes("EXTRACTION")
                            ? "money"
                            : "document"
                    }
                  />
                </span>
                <div>
                  <strong>{entry.label}</strong>
                  <time>{formatDateTime(entry.createdAt)}</time>
                  <small>{entry.actor?.fullName ?? entry.actor?.email ?? "Sistema"}</small>
                </div>
                {index < Math.min(data.history.length, 5) - 1 ? <i /> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </PortalShell>
  );
}

function MetadataItem({
  green = false,
  icon,
  label,
  value,
}: {
  green?: boolean;
  icon: "calendar" | "document" | "help" | "money";
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className={green ? styles.metadataGreen : styles.metadataBlue}>
        <Icon name={icon} />
      </span>
      <dl>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </dl>
    </div>
  );
}

function validationDecisionLabel(value: string) {
  if (value === "SUSPICION_CONFIRMED") return "Suspeita confirmada";
  if (value === "FALSE_POSITIVE") return "Alerta descartado";
  if (value === "NOTE_VALID") return "Nota OK";
  return "Apontamento confirmado";
}

function rawValue(value: Prisma.JsonValue | null, keys: string[]) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  for (const key of keys) {
    const entry = value[key];
    if (typeof entry === "string" || typeof entry === "number") {
      return String(entry);
    }
  }
  return null;
}

function formatMaybeCurrency(value: string | null) {
  return value ? formatCurrency(value) : "Não identificado";
}

import Link from "next/link";

import {
  PortalShell,
  StatusBadge,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";
import {
  auditResultLabel,
  auditResultTone,
} from "@/features/workspace-ui/audit-result-label";

import type { NoteDetailData } from "./data";
import { NoteAnalysisExplorer } from "./note-analysis-explorer";
import { NoteDocumentPreview } from "./note-document-preview";
import { formatCurrency, formatDate, formatDecimal } from "./note-detail-format";
import styles from "./note-detail.module.css";

export function NoteAnalysisView({
  data,
  documentUrl,
  userEmail,
}: {
  data: NoteDetailData;
  documentUrl: string | null;
  userEmail: string;
}) {
  const role: PortalRole = data.viewerRole === "ADMIN" ? "admin" : "reviewer";
  const basePath = role === "admin" ? "/admin" : "/revisao";
  const rawClassification = auditResultLabel(
    data.analysis.auditResult,
    data.analysis.classification,
    data.status,
  );
  const classification =
    rawClassification === "Suspeita" && data.analysis.findings.length === 0
      ? "Análise incompleta"
      : rawClassification;
  const number = attachmentReference(data.number, data.id);
  const supplier = data.supplier.name ?? "Fornecedor não identificado";
  const total = formatCurrency(data.totalAmount);
  const backHref = role === "admin" ? `/notas/${data.id}` : `${basePath}/notas`;
  const backLabel = role === "admin" ? "Voltar ao detalhe da nota" : "Voltar para notas";

  return (
    <PortalShell active="notas" role={role} userEmail={userEmail}>
      <div className={styles.analysisPage}>
        <nav className={styles.breadcrumb} aria-label="Navegação estrutural">
          <Link href={`${basePath}/notas`}>Notas</Link>
          {role === "admin" ? (
            <>
              <Icon name="chevron" />
              <Link href={`/notas/${data.id}`}>Auditoria comparativa</Link>
            </>
          ) : null}
          <Icon name="chevron" />
          <strong>Análise completa da IA</strong>
        </nav>

        <header className={styles.analysisHeader}>
          <div>
            <div className={styles.titleRow}>
              <h1>Análise completa da IA</h1>
              <StatusBadge tone={auditResultTone(classification)}>
                ● &nbsp;{classification}
              </StatusBadge>
              {data.demoLabel ? (
                <span className={styles.demoBadge}>{data.demoLabel}</span>
              ) : null}
            </div>
            <p>
              Entenda cada apontamento identificado pela IA e as evidências
              encontradas na nota fiscal eletrônica.
            </p>
          </div>
          <Link className={styles.backButton} href={backHref}>
            <Icon name="chevron" /> {backLabel}
          </Link>
        </header>

        <section className={styles.metadataStrip} aria-label="Resumo da nota">
          <MetadataItem icon="document" label="Obra" value={data.work.name} />
          <MetadataItem
            icon="help"
            label="Fornecedor"
            value={supplier}
          />
          <MetadataItem
            icon="document"
            label="Número da nota"
            value={number}
          />
          <MetadataItem
            icon="calendar"
            label="Data da emissão"
            value={formatDate(data.issuedAt)}
          />
          <MetadataItem
            icon="money"
            label="Valor da nota (R$)"
            value={total}
            green
          />
        </section>

        <NoteAnalysisExplorer
          findings={data.analysis.findings}
          items={data.items}
        />

        <section className={styles.analysisSourceSection}>
          <header className={styles.analysisSourceHeader}>
            <div>
              <span>Documento auditado</span>
              <h2>Nota fiscal e dados extraídos</h2>
              <p>Consulte o arquivo original e os campos usados no diagnóstico.</p>
            </div>
            {documentUrl ? (
              <a href={documentUrl} target="_blank" rel="noreferrer">
                Abrir arquivo em nova aba ↗
              </a>
            ) : null}
          </header>

          <div className={styles.analysisSourceGrid}>
            <article className={`${styles.card} ${styles.analysisDocumentCard}`}>
              <header className={styles.cardHeader}>
                <h3>Arquivo original</h3>
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
            </article>

            <article className={`${styles.card} ${styles.analysisExtractedCard}`}>
              <header className={styles.cardHeader}>
                <div>
                  <h3>Dados extraídos</h3>
                  <p>Informações identificadas automaticamente no arquivo.</p>
                </div>
              </header>
              <dl className={styles.analysisExtractedGrid}>
                <div><dt>Número do anexo</dt><dd>{number}</dd></div>
                <div><dt>Fornecedor</dt><dd>{supplier}</dd></div>
                <div><dt>CNPJ do fornecedor</dt><dd>{data.supplier.taxId ?? "Não identificado"}</dd></div>
                <div><dt>Data de emissão</dt><dd>{formatDate(data.issuedAt)}</dd></div>
                <div><dt>Valor total</dt><dd>{total}</dd></div>
                <div><dt>Obra</dt><dd>{data.work.name}</dd></div>
              </dl>

              <section className={styles.analysisItemsSection}>
                <header>
                  <h3>Itens identificados</h3>
                  <span>{data.items.length}</span>
                </header>
                {data.items.length ? (
                  <>
                    <div className={styles.analysisItemsTable}>
                      <table>
                        <thead>
                          <tr><th>Descrição</th><th>QTD.</th><th>Valor unit.</th><th>Total</th></tr>
                        </thead>
                        <tbody>
                          {data.items.map((item) => (
                            <tr key={item.id}>
                              <td>{item.description}</td>
                              <td>{formatDecimal(item.quantity, 0)}</td>
                              <td>{formatDecimal(item.unitPrice)}</td>
                              <td>{formatDecimal(item.totalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className={styles.analysisItemCards}>
                      {data.items.map((item) => (
                        <article key={item.id}>
                          <strong>{item.description}</strong>
                          <dl>
                            <div><dt>Quantidade</dt><dd>{formatDecimal(item.quantity, 0)}</dd></div>
                            <div><dt>Valor unitário</dt><dd>{formatDecimal(item.unitPrice)}</dd></div>
                            <div><dt>Total</dt><dd>{formatDecimal(item.totalAmount)}</dd></div>
                          </dl>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className={styles.analysisNoItems}>Nenhum item individual foi identificado.</p>
                )}
              </section>
            </article>
          </div>
        </section>

        <div className={styles.analysisBottomBack}>
          <Link className={styles.backButton} href={backHref}>
            <Icon name="chevron" /> {backLabel}
          </Link>
        </div>
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

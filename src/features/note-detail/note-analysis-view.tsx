import Link from "next/link";

import {
  PortalShell,
  StatusBadge,
  type PortalRole,
} from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";

import type { NoteDetailData } from "./data";
import { NoteAnalysisExplorer } from "./note-analysis-explorer";
import { formatCurrency, formatDate } from "./note-detail-format";
import styles from "./note-detail.module.css";

export function NoteAnalysisView({
  data,
  userEmail,
}: {
  data: NoteDetailData;
  userEmail: string;
}) {
  const role: PortalRole = data.viewerRole === "ADMIN" ? "admin" : "reviewer";
  const basePath = role === "admin" ? "/admin" : "/revisao";
  const classification =
    data.analysis.classification === "OK" ? "OK" : "Suspeita";

  return (
    <PortalShell active="notas" role={role} userEmail={userEmail}>
      <div className={styles.analysisPage}>
        <nav className={styles.breadcrumb} aria-label="Navegação estrutural">
          <Link href={`${basePath}/notas`}>Notas</Link>
          <Icon name="chevron" />
          <Link href={`/notas/${data.id}`}>Detalhe da nota</Link>
          <Icon name="chevron" />
          <strong>Análise completa da IA</strong>
        </nav>

        <header className={styles.analysisHeader}>
          <div>
            <div className={styles.titleRow}>
              <h1>Análise completa da IA</h1>
              <StatusBadge tone={classification === "OK" ? "ok" : "warning"}>
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
          <Link className={styles.backButton} href={`/notas/${data.id}`}>
            <Icon name="chevron" /> Voltar ao detalhe da nota
          </Link>
        </header>

        <section className={styles.metadataStrip} aria-label="Resumo da nota">
          <MetadataItem icon="document" label="Obra" value={data.work.name} />
          <MetadataItem
            icon="help"
            label="Fornecedor"
            value={data.supplier.name ?? "Fornecedor não identificado"}
          />
          <MetadataItem
            icon="document"
            label="Número da nota"
            value={data.number ?? "Sem número"}
          />
          <MetadataItem
            icon="calendar"
            label="Data da emissão"
            value={formatDate(data.issuedAt)}
          />
          <MetadataItem
            icon="money"
            label="Valor da nota (R$)"
            value={formatCurrency(data.totalAmount)}
            green
          />
        </section>

        <NoteAnalysisExplorer
          findings={data.analysis.findings}
          items={data.items}
          sources={data.analysis.sources}
        />

        <div className={styles.analysisBottomBack}>
          <Link className={styles.backButton} href={`/notas/${data.id}`}>
            <Icon name="chevron" /> Voltar ao detalhe da nota
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

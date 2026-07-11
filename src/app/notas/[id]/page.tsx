import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { prisma } from "@/server/db/prisma";
import { createInvoiceSignedUrl } from "@/server/storage";

import styles from "./detail.module.css";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusLabels: Record<string, string> = { RECEIVED: "Recebida", PROCESSING: "Em processamento", OK: "OK", PENDING_VALIDATION: "Pendente de validação", APPROVED: "Aprovada", REJECTED: "Rejeitada", READ_FAILED: "Falha de leitura", FAILED: "Falha no processamento" };
const classificationLabels: Record<string, string> = { OK: "OK", SUSPICIOUS: "Suspeita", INCOMPATIBLE: "Incompatível" };
const severityLabels: Record<string, string> = { INFO: "Informativo", WARNING: "Atenção", CRITICAL: "Crítico" };
const eventLabels: Record<string, string> = { NOTE_RECEIVED: "Nota recebida", EXTRACTION_STARTED: "Extração iniciada", EXTRACTION_COMPLETED: "Extração concluída", ANALYSIS_STARTED: "Análise iniciada", ANALYSIS_COMPLETED: "Análise concluída", STATUS_CHANGED: "Status atualizado", VALIDATION_CREATED: "Validação registrada" };
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnlyFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

type NoteDetailPageProps = { params: Promise<{ id: string }> };
function formatDate(value: Date | null | undefined, includeTime = true) { if (!value) return "Não informado"; return includeTime ? dateFormatter.format(value) : dateOnlyFormatter.format(value); }
function formatMoney(value: { toNumber(): number } | null | undefined) { return value ? currencyFormatter.format(value.toNumber()) : "Não informado"; }
function formatNumber(value: { toNumber(): number } | null | undefined) { return value ? numberFormatter.format(value.toNumber()) : "—"; }
function stringifyJson(value: unknown) { return value === null || value === undefined ? "Não informado" : JSON.stringify(value, null, 2); }
function labelStatus(value: string | null | undefined) { return value ? statusLabels[value] ?? value : "Não classificada"; }
async function getSignedDocumentUrl(path: string) { try { return (await createInvoiceSignedUrl({ path })).signedUrl; } catch { return null; } }

export default async function NoteDetailPage({ params }: NoteDetailPageProps) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/notas/${id}`)}`);

  const note = await prisma.note.findUnique({
    where: { id },
    include: {
      work: { select: { name: true, code: true, location: true } },
      submittedBy: { select: { fullName: true, email: true } },
      items: { orderBy: { lineNumber: "asc" } },
      findings: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }], include: { noteItem: { select: { lineNumber: true, description: true } }, rule: { select: { code: true, name: true, category: true, description: true, configuration: true } } } },
      validations: { orderBy: { createdAt: "desc" }, include: { validator: { select: { fullName: true, email: true } } } },
      events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { fullName: true, email: true } } } },
    },
  });
  if (!note) notFound();
  const documentUrl = await getSignedDocumentUrl(note.originalFilePath);
  const isImage = note.originalMimeType.startsWith("image/");
  const classification = note.classification ? classificationLabels[note.classification] ?? note.classification : "Ainda não classificada";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.logo} href="/notas"><span>W</span> Winfra<strong>BR</strong></Link>
        <nav aria-label="Navegação principal"><Link className={styles.activeNav} href="/notas">Notas</Link><Link href="/validacoes">Validações</Link></nav>
        <LogoutButton className={styles.logout} />
      </header>
      <div className={styles.container}>
        <Link className={styles.backLink} href="/notas">← Voltar para notas</Link>
        <header className={styles.pageHeader}>
          <div><span className={styles.eyebrow}>Detalhe da nota</span><h1>{note.documentNumber ? `Nota ${note.documentNumber}` : note.originalFileName}</h1><p>{note.supplierName || "Fornecedor não identificado"} · {note.work.name}</p></div>
          <div className={styles.headerBadges}><span className={`${styles.badge} ${styles[`status_${note.status}`]}`}>{labelStatus(note.status)}</span><span className={`${styles.badge} ${note.classification ? styles[`classification_${note.classification}`] : styles.neutral}`}>{classification}</span></div>
        </header>
        <section className={styles.summaryGrid} aria-label="Resumo da nota">
          <Summary label="Valor total" value={formatMoney(note.totalAmount)} /><Summary label="Emissão" value={formatDate(note.issuedAt, false)} /><Summary label="CNPJ/CPF" value={note.supplierTaxId || "Não informado"} /><Summary label="Recebida em" value={formatDate(note.receivedAt)} /><Summary label="Confiança da leitura" value={note.readConfidence ? `${numberFormatter.format(note.readConfidence.toNumber() * 100)}%` : "Não informada"} />
        </section>
        {note.failureMessage ? <div className={styles.failure} role="alert"><strong>Falha de processamento</strong><span>{note.failureMessage}</span></div> : null}

        <div className={styles.mainGrid}>
          <section className={`${styles.panel} ${styles.documentPanel}`}>
            <PanelTitle title="Documento original" subtitle={note.originalFileName} />
            {documentUrl ? <><div className={styles.documentPreview}>{isImage ? <Image alt={`Documento original ${note.originalFileName}`} fill sizes="(max-width: 900px) 100vw, 34vw" src={documentUrl} unoptimized /> : <iframe src={documentUrl} title={`Documento original ${note.originalFileName}`} />}</div><a className={styles.downloadLink} href={documentUrl} rel="noreferrer" target="_blank">Abrir original em nova guia ↗</a></> : <div className={styles.previewUnavailable}><span aria-hidden="true">▤</span><strong>Prévia indisponível</strong><p>Não foi possível gerar o acesso temporário ao arquivo.</p></div>}
            <dl className={styles.fileMetadata}><div><dt>Formato</dt><dd>{note.originalMimeType}</dd></div><div><dt>Tamanho</dt><dd>{numberFormatter.format(Number(note.originalSizeBytes) / 1024 / 1024)} MB</dd></div></dl>
          </section>

          <section className={`${styles.panel} ${styles.dataPanel}`}>
            <PanelTitle title="Dados extraídos" subtitle="Informações identificadas na nota" />
            <dl className={styles.detailsList}><Detail label="Fornecedor" value={note.supplierName} /><Detail label="CNPJ/CPF" value={note.supplierTaxId} /><Detail label="Número" value={note.documentNumber} /><Detail label="Data de emissão" value={formatDate(note.issuedAt, false)} /><Detail label="Valor total" value={formatMoney(note.totalAmount)} /></dl>
            <details className={styles.expandable}><summary>Ver JSON completo</summary><pre>{stringifyJson(note.extractedData)}</pre></details>
            <details className={styles.expandable} open={Boolean(note.extractionMarkdown)}><summary>Resumo da extração</summary><div className={styles.markdown}>{note.extractionMarkdown || "Resumo ainda não disponível."}</div></details>
          </section>

          <section className={`${styles.panel} ${styles.analysisPanel}`}>
            <PanelTitle title="Análise e achados" subtitle={`${note.findings.length} apontamento${note.findings.length === 1 ? "" : "s"}`} />
            {note.findings.length ? <div className={styles.findingList}>{note.findings.map((finding) => <article className={`${styles.finding} ${styles[`severity_${finding.severity}`]}`} key={finding.id}>
              <div className={styles.findingHeader}><span>{severityLabels[finding.severity] ?? finding.severity}</span><small>{finding.category}</small></div><h3>{finding.title}</h3><p>{finding.description}</p>
              {finding.noteItem ? <p className={styles.itemReference}>Item {finding.noteItem.lineNumber}: {finding.noteItem.description}</p> : null}
              {finding.rule ? <details className={styles.ruleDetails}><summary>Regra aplicada: {finding.rule.name}</summary><dl><Detail label="Código" value={finding.rule.code} /><Detail label="Categoria" value={finding.rule.category} /><Detail label="Descrição" value={finding.rule.description} /></dl>{finding.rule.configuration ? <pre>{stringifyJson(finding.rule.configuration)}</pre> : null}</details> : <span className={styles.noRule}>Sem regra vinculada</span>}
              <details className={styles.evidenceDetails}><summary>Ver evidências e valores</summary><div><strong>Evidência</strong><pre>{stringifyJson(finding.evidence)}</pre></div><div><strong>Esperado</strong><pre>{stringifyJson(finding.expectedValue)}</pre></div><div><strong>Encontrado</strong><pre>{stringifyJson(finding.actualValue)}</pre></div></details>
            </article>)}</div> : <div className={styles.emptyState}><span aria-hidden="true">✓</span><strong>Nenhum achado registrado</strong><p>A análise não identificou apontamentos para esta nota.</p></div>}
          </section>
        </div>

        <section className={`${styles.panel} ${styles.itemsPanel}`}>
          <PanelTitle title="Itens da nota" subtitle={`${note.items.length} item${note.items.length === 1 ? "" : "s"} extraído${note.items.length === 1 ? "" : "s"}`} />
          {note.items.length ? <div className={styles.tableWrap}><table><thead><tr><th>#</th><th>Descrição</th><th>Código</th><th>Quantidade</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>{note.items.map((item) => <tr key={item.id}><td>{item.lineNumber}</td><td>{item.description}</td><td>{item.code || "—"}</td><td>{formatNumber(item.quantity)} {item.unit || ""}</td><td>{formatMoney(item.unitPrice)}</td><td>{formatMoney(item.totalAmount)}</td></tr>)}</tbody></table></div> : <p className={styles.simpleEmpty}>Nenhum item extraído.</p>}
        </section>

        <section className={`${styles.panel} ${styles.historyPanel}`}>
          <PanelTitle title="Histórico" subtitle="Eventos e decisões já registradas" />
          {note.events.length || note.validations.length ? <div className={styles.timeline}>
            {note.validations.map((validation) => <article key={`validation-${validation.id}`}><span className={styles.timelineDot} /><div><strong>Validação: {validation.decision.replaceAll("_", " ").toLowerCase()}</strong><p>{validation.reason}{validation.comment ? ` — ${validation.comment}` : ""}</p><small>{formatDate(validation.createdAt)} · {validation.validator.fullName || validation.validator.email}</small></div></article>)}
            {note.events.map((event) => <article key={`event-${event.id}`}><span className={styles.timelineDot} /><div><strong>{eventLabels[event.type] ?? event.type.replaceAll("_", " ").toLowerCase()}</strong><p>{event.fromStatus || event.toStatus ? `${event.fromStatus ? labelStatus(event.fromStatus) : ""}${event.fromStatus && event.toStatus ? " → " : ""}${event.toStatus ? labelStatus(event.toStatus) : ""}` : "Evento registrado no processamento da nota."}</p><small>{formatDate(event.createdAt)}{event.actor ? ` · ${event.actor.fullName || event.actor.email}` : " · Sistema"}</small>{event.data ? <details className={styles.eventData}><summary>Dados do evento</summary><pre>{stringifyJson(event.data)}</pre></details> : null}</div></article>)}
          </div> : <p className={styles.simpleEmpty}>Nenhum evento adicional registrado.</p>}
        </section>
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) { return <div className={styles.summaryCard}><span>{label}</span><strong>{value}</strong></div>; }
function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) { return <header className={styles.panelTitle}><h2>{title}</h2><p>{subtitle}</p></header>; }
function Detail({ label, value }: { label: string; value: string | null | undefined }) { return <div><dt>{label}</dt><dd>{value || "Não informado"}</dd></div>; }

import Link from "next/link";
import { notFound } from "next/navigation";

import { attachmentReference } from "@/features/internal-notes/attachment-reference";
import {
  formatFindingValue,
  formatReviewerFindingParts,
  humanizeFindingText,
} from "@/features/internal-notes/finding-display";
import { PortalShell, StatusBadge } from "@/features/workspace-ui/portal-shell";
import { Icon } from "@/features/workspace-ui/ui-icons";
import { prisma } from "@/server/db/prisma";

import styles from "./log-detail.module.css";

const LOG_ID = /^(AI|EVENT|VALIDATION|ADMIN)-([0-9a-f-]{36})$/i;

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "America/Sao_Paulo",
});

type TimelineEntry = {
  at: Date;
  detail: string;
  id: string;
  label: string;
  type: "event" | "run";
};

type DetailRow = { label: string; value: string };

type HarnessFindingDetail = {
  actual: string;
  code: string;
  confidence: string;
  description: string;
  evidence: ReturnType<typeof formatReviewerFindingParts>;
  expected: string;
  justification: string;
  severity: string;
  title: string;
};

type HarnessExplanation = {
  contextQuestionCount: number;
  coverageAreas: string[];
  findings: HarnessFindingDetail[];
  summary: string;
};

type LoadedLog = {
  at: Date;
  comment: string;
  id: string;
  noteId: string | null;
  noteNumber: string;
  raw: unknown;
  rows: DetailRow[];
  harness?: HarnessExplanation;
  status: string;
  title: string;
  user: string;
  work: string;
};

type PageProps = { params: Promise<{ logId: string }> };

export default async function AdminLogDetailPage({ params }: PageProps) {
  const rawLogId = decodeURIComponent((await params).logId);
  const parsed = LOG_ID.exec(rawLogId);
  if (!parsed) notFound();

  const detail = await loadLog(parsed[1].toUpperCase(), parsed[2]);
  if (!detail) notFound();
  const timeline = detail.noteId ? await loadTimeline(detail.noteId) : [];

  return (
    <PortalShell active="logs" role="admin">
      <main className={styles.page}>
        <nav className={styles.breadcrumb} aria-label="Navegação estrutural">
          <Link href="/admin/logs">Logs</Link>
          <Icon name="chevron" />
          <strong>Execução completa</strong>
        </nav>

        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>RASTREABILIDADE TÉCNICA</p>
            <h1>{detail.title}</h1>
            <p>{detail.comment}</p>
          </div>
          <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
        </header>

        <section className={styles.summary} aria-label="Resumo do log">
          <Summary label="Data e hora" value={dateTime.format(detail.at)} />
          <Summary label="Responsável" value={detail.user} />
          <Summary label="Anexo" value={detail.noteNumber} />
          <Summary label="Obra" value={detail.work} />
        </section>

        <div className={styles.layout}>
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <span className={styles.cardIcon}><Icon name="document" /></span>
                <div><h2>Dados completos da execução</h2><p>Configuração, consumo, versões e resultado seguro.</p></div>
              </div>
            </header>
            <dl className={styles.detailGrid}>
              {detail.rows.map((row) => (
                <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
            {detail.noteId ? (
              <div className={styles.actions}>
                <Link href={`/notas/${detail.noteId}`}>Abrir auditoria do anexo</Link>
                <Link href={`/admin/logs?noteId=${encodeURIComponent(detail.noteId)}`}>Ver todos os logs deste anexo</Link>
              </div>
            ) : null}
          </section>

          <aside className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <span className={styles.cardIcon}><Icon name="clock" /></span>
                <div><h2>Como o Harness processou</h2><p>Etapas persistidas em ordem cronológica.</p></div>
              </div>
            </header>
            {timeline.length ? (
              <ol className={styles.timeline}>
                {timeline.map((entry) => (
                  <li key={`${entry.type}-${entry.id}`}>
                    <span className={styles.timelineDot} />
                    <time>{dateTime.format(entry.at)}</time>
                    <strong>{entry.label}</strong>
                    <p>{entry.detail}</p>
                    {entry.type === "run" ? (
                      detail.id === `AI-${entry.id}` ? (
                        <span className={styles.currentRun}>Execução aberta</span>
                      ) : (
                        <Link href={`/admin/logs/AI-${entry.id}`}>Abrir esta execução</Link>
                      )
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : <p className={styles.empty}>Nenhuma etapa relacionada foi registrada.</p>}
          </aside>
        </div>

        {detail.harness ? <HarnessExplanationCard explanation={detail.harness} /> : null}

        <details className={styles.raw}>
          <summary>Resposta estruturada e dados técnicos persistidos</summary>
          <p>Este bloco mostra a saída estruturada salva pelo sistema. Raciocínio interno do modelo não é armazenado nem exibido.</p>
          <pre>{safeJson(detail.raw)}</pre>
        </details>

        <footer className={styles.footer}>
          <Link href="/admin/logs"><Icon name="chevron" /> Voltar aos logs</Link>
          <small>ID: {detail.id}</small>
        </footer>
      </main>
    </PortalShell>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <dl><dt>{label}</dt><dd>{value}</dd></dl>;
}

function HarnessExplanationCard({
  explanation,
}: {
  explanation: HarnessExplanation;
}) {
  return (
    <section className={styles.harnessExplanation}>
      <header className={styles.cardHeader}>
        <div>
          <span className={styles.cardIcon}><Icon name="shield" /></span>
          <div>
            <h2>Leitura explicável do Harness</h2>
            <p>Resultado estruturado, evidências e critérios usados — sem raciocínio interno.</p>
          </div>
        </div>
      </header>
      <div className={styles.harnessSummary}>
        <div>
          <span>Conclusão registrada</span>
          <p>{humanizeFindingText(explanation.summary)}</p>
        </div>
        <div>
          <span>Cobertura</span>
          {explanation.coverageAreas.length ? (
            <ul>
              {explanation.coverageAreas.map((area) => <li key={area}>{humanizeFindingText(area)}</li>)}
            </ul>
          ) : <p>Cobertura não detalhada nesta execução.</p>}
        </div>
        <div>
          <span>Perguntas de contexto</span>
          <strong>{explanation.contextQuestionCount}</strong>
          <p>{explanation.contextQuestionCount ? "Perguntas externas foram registradas." : "Nenhuma pergunta externa foi necessária."}</p>
        </div>
      </div>
      <div className={styles.harnessFindings}>
        <div className={styles.harnessFindingsHeader}>
          <h3>Achados sustentados</h3>
          <span>{explanation.findings.length}</span>
        </div>
        {explanation.findings.length ? explanation.findings.map((finding, index) => (
          <article key={`${finding.code}-${index}`}>
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h4>{humanizeFindingText(finding.title)}</h4><small>{finding.code}</small></div>
              <strong>{finding.severity} · {finding.confidence}</strong>
            </header>
            <p>{humanizeFindingText(finding.description)}</p>
            {finding.evidence.length ? (
              <dl className={styles.harnessEvidence}>
                {finding.evidence.map((part, partIndex) => (
                  <div key={`${part.label}-${partIndex}`}><dt>{part.label}</dt><dd>{part.value}</dd></div>
                ))}
              </dl>
            ) : null}
            <div className={styles.harnessComparison}>
              <div><span>Esperado</span><p>{finding.expected}</p></div>
              <div><span>Encontrado</span><p>{finding.actual}</p></div>
            </div>
            <footer><strong>Por que chamou atenção</strong><p>{humanizeFindingText(finding.justification)}</p></footer>
          </article>
        )) : <p className={styles.empty}>Esta execução não persistiu nenhum achado sustentado.</p>}
      </div>
    </section>
  );
}

async function loadLog(kind: string, id: string): Promise<LoadedLog | null> {
  if (kind === "AI") {
    const run = await prisma.aiRun.findUnique({
      where: { id },
      include: {
        findings: {
          orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
          select: {
            actualValue: true,
            code: true,
            confidence: true,
            description: true,
            evidence: true,
            expectedValue: true,
            justification: true,
            severity: true,
            title: true,
          },
        },
        note: { select: { documentNumber: true, id: true, work: { select: { name: true } } } },
        processingJob: { select: { attempt: true, lastErrorCode: true, maxAttempts: true, status: true, type: true } },
      },
    });
    if (!run) return null;
    const findingDetails: HarnessFindingDetail[] = run.findings.map((finding) => ({
      actual: formatFindingValue(finding.actualValue, "Não informado"),
      code: finding.code,
      confidence: `${Math.round(finding.confidence.toNumber() * 100)}%`,
      description: finding.description,
      evidence: formatReviewerFindingParts(finding.evidence),
      expected: formatFindingValue(finding.expectedValue, "Não informado"),
      justification: finding.justification,
      severity: severityLabel(finding.severity),
      title: finding.title,
    }));
    const structured = isRecord(run.structuredResponse) ? run.structuredResponse : {};
    const coverage = isRecord(structured.coverage) ? structured.coverage : {};
    const coverageAreas = stringList(coverage.areas);
    const contextQuestionCount = stringList(structured.contextQuestionCodes).length;
    const summary = typeof structured.summary === "string" && structured.summary.trim()
      ? structured.summary.trim()
      : run.kind === "EXTRACTION"
        ? "O arquivo foi lido e normalizado para a etapa de auditoria."
        : findingDetails.length
          ? `A auditoria concluiu ${findingDetails.length} achado(s) sustentado(s).`
          : "A auditoria não persistiu achados sustentados nesta execução.";
    const findings = findingDetails.map((finding) => ({
      achado: finding.title,
      codigo: finding.code,
      confianca: finding.confidence,
      evidencia: finding.evidence,
      esperado: finding.expected,
      encontrado: finding.actual,
      gravidade: finding.severity,
    }));
    return {
      at: run.createdAt,
      comment: run.kind === "EXTRACTION"
        ? "Leitura e normalização dos campos do documento."
        : "Aplicação das regras do Harness e avaliação estruturada da IA.",
      id: `AI-${run.id}`,
      harness: {
        contextQuestionCount,
        coverageAreas,
        findings: findingDetails,
        summary,
      },
      noteId: run.note.id,
      noteNumber: attachmentReference(run.note.documentNumber, run.note.id),
      raw: { findings, response: run.structuredResponse },
      rows: [
        { label: "Etapa", value: run.kind === "EXTRACTION" ? "Extração estruturada" : "Auditoria" },
        { label: "Status", value: run.status },
        { label: "Modelo", value: run.model },
        { label: "Provedor", value: run.provider ?? "Não informado" },
        { label: "Esforço", value: run.reasoningEffort },
        { label: "Versão da política", value: run.policyVersion },
        { label: "Versão do prompt", value: run.promptVersion },
        { label: "Versão do schema", value: run.schemaVersion },
        { label: "Tokens de entrada", value: numberLabel(run.promptTokens) },
        { label: "Tokens de saída", value: numberLabel(run.completionTokens) },
        { label: "Tokens totais", value: numberLabel(run.totalTokens) },
        { label: "Custo", value: usdLabel(run.costUsd?.toString() ?? null) },
        { label: "Latência", value: run.latencyMs === null ? "Não informada" : `${run.latencyMs.toLocaleString("pt-BR")} ms` },
        { label: "Tentativas do provedor", value: String(run.attempts) },
        { label: "Job", value: run.processingJob ? `${run.processingJob.type} · ${run.processingJob.status} · tentativa ${run.processingJob.attempt}/${run.processingJob.maxAttempts}` : "Sem job vinculado" },
        { label: "Código de falha", value: run.errorCode ?? run.processingJob?.lastErrorCode ?? "Nenhuma falha" },
        { label: "Mensagem segura", value: run.errorMessage ?? "Execução sem erro persistido" },
      ],
      status: run.status,
      title: run.kind === "EXTRACTION" ? "Log da extração estruturada" : "Log da auditoria da IA",
      user: "Sistema",
      work: run.note.work.name,
    };
  }

  if (kind === "EVENT") {
    const event = await prisma.noteEvent.findUnique({
      where: { id },
      include: {
        actor: { select: { email: true, fullName: true } },
        note: { select: { documentNumber: true, id: true, work: { select: { name: true } } } },
      },
    });
    if (!event) return null;
    return {
      at: event.createdAt,
      comment: eventDescription(event.type, event.data),
      id: `EVENT-${event.id}`,
      noteId: event.note.id,
      noteNumber: attachmentReference(event.note.documentNumber, event.note.id),
      raw: event.data,
      rows: [
        { label: "Tipo do evento", value: event.type },
        { label: "Status anterior", value: event.fromStatus ?? "Não se aplica" },
        { label: "Novo status", value: event.toStatus ?? "Não se aplica" },
        { label: "Ator", value: event.actor?.fullName ?? event.actor?.email ?? "Sistema" },
      ],
      status: event.toStatus ?? event.type,
      title: eventLabel(event.type),
      user: event.actor?.fullName ?? event.actor?.email ?? "Sistema",
      work: event.note.work.name,
    };
  }

  if (kind === "VALIDATION") {
    const validation = await prisma.validation.findUnique({
      where: { id },
      include: {
        note: { select: { documentNumber: true, id: true, work: { select: { name: true } } } },
        validator: { select: { email: true, fullName: true } },
      },
    });
    if (!validation) return null;
    return {
      at: validation.createdAt,
      comment: validation.comment ?? "Decisão registrada sem comentário adicional.",
      id: `VALIDATION-${validation.id}`,
      noteId: validation.note.id,
      noteNumber: attachmentReference(validation.note.documentNumber, validation.note.id),
      raw: validation.findingSnapshot,
      rows: [
        { label: "Decisão", value: validation.decision },
        { label: "Motivo", value: validation.reason },
        { label: "Versão da nota", value: String(validation.noteVersion) },
        { label: "Versão da política", value: validation.policyVersion ?? "Não informada" },
      ],
      status: "Decisão registrada",
      title: "Log da decisão humana",
      user: validation.validator.fullName ?? validation.validator.email,
      work: validation.note.work.name,
    };
  }

  const admin = await prisma.adminAuditLog.findUnique({ where: { id } });
  if (!admin) return null;
  const noteId = admin.entityType === "note" && /^[0-9a-f-]{36}$/i.test(admin.entityId ?? "") ? admin.entityId : null;
  const note = noteId
    ? await prisma.note.findUnique({ where: { id: noteId }, select: { documentNumber: true, work: { select: { name: true } } } })
    : null;
  return {
    at: admin.createdAt,
    comment: "Ação administrativa registrada na trilha imutável do sistema.",
    id: `ADMIN-${admin.id}`,
    noteId,
    noteNumber: note && noteId ? attachmentReference(note.documentNumber, noteId) : "Não vinculado",
    raw: admin.data,
    rows: [
      { label: "Ação", value: admin.action },
      { label: "Tipo da entidade", value: admin.entityType },
      { label: "ID da entidade", value: admin.entityId ?? "Não informado" },
      { label: "ID da requisição", value: admin.requestId ?? "Não informado" },
    ],
    status: "Registrado",
    title: "Log administrativo",
    user: admin.actorEmail ?? "Sistema",
    work: note?.work.name ?? "Administração",
  };
}

async function loadTimeline(noteId: string): Promise<TimelineEntry[]> {
  const [events, runs] = await Promise.all([
    prisma.noteEvent.findMany({ where: { noteId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 80, select: { createdAt: true, data: true, id: true, type: true } }),
    prisma.aiRun.findMany({ where: { noteId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20, select: { createdAt: true, errorCode: true, id: true, kind: true, model: true, policyVersion: true, status: true } }),
  ]);
  return [
    ...events.map((event) => ({ at: event.createdAt, detail: eventDescription(event.type, event.data), id: event.id, label: eventLabel(event.type), type: "event" as const })),
    ...runs.map((run) => ({
      at: run.createdAt,
      detail: `${run.kind === "EXTRACTION" ? "Extração" : "Auditoria"} com ${run.model}, política ${run.policyVersion}${run.errorCode ? `; falha ${run.errorCode}` : "; resultado persistido"}.`,
      id: run.id,
      label: `${run.kind === "EXTRACTION" ? "Leitura da IA" : "Avaliação do Harness"} · ${run.status}`,
      type: "run" as const,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    AUDIT_COMPLETED: "Auditoria concluída",
    EXTRACTION_COMPLETED: "Extração concluída",
    EXTRACTION_STARTED: "Extração iniciada",
    FILE_STORED: "Arquivo armazenado",
    NOTE_RECEIVED: "Anexo recebido",
    PROCESSING_STARTED: "Processamento iniciado",
    READ_FAILED: "Falha de leitura",
    REPROCESS_SCHEDULED: "Reprocessamento agendado",
    UPLOAD_RECEIVED: "Upload recebido",
    VALIDATION_RECORDED: "Decisão humana registrada",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function eventDescription(type: string, data: unknown) {
  const record = isRecord(data) ? data : {};
  const file = typeof record.fileName === "string" ? ` O arquivo ${record.fileName} foi reconhecido.` : "";
  const findings = typeof record.findingCount === "number" ? ` ${record.findingCount} achado(s) foram persistidos.` : "";
  const descriptions: Record<string, string> = {
    AUDIT_COMPLETED: `O Harness concluiu as regras determinísticas, validou a resposta da IA e registrou a classificação.${findings}`,
    EXTRACTION_COMPLETED: "Os campos, itens e evidências legíveis foram normalizados para a auditoria.",
    EXTRACTION_STARTED: "O worker iniciou a leitura estruturada do documento pelo modelo configurado.",
    FILE_STORED: `O arquivo original foi salvo com segurança e liberado para processamento.${file}`,
    NOTE_RECEIVED: `O anexo entrou na fila persistente de processamento.${file}`,
    PROCESSING_STARTED: "O worker obteve a trava do job e iniciou a etapa pendente.",
    READ_FAILED: "O sistema não obteve dados mínimos confiáveis depois das tentativas permitidas.",
    REPROCESS_SCHEDULED: "Uma nova execução foi criada preservando os dados já confiáveis.",
    UPLOAD_RECEIVED: `O upload foi validado e aceito pelo sistema.${file}`,
    VALIDATION_RECORDED: "A decisão humana foi adicionada ao histórico sem apagar a análise anterior.",
  };
  return descriptions[type] ?? "Etapa registrada na linha do tempo do anexo.";
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return "Sem conteúdo estruturado adicional.";
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function severityLabel(value: string) {
  if (value === "CRITICAL") return "Alta";
  if (value === "WARNING") return "Média";
  return "Informativa";
}

function numberLabel(value: number | null) {
  return value === null ? "Não informado" : value.toLocaleString("pt-BR");
}

function usdLabel(value: string | null) {
  if (!value) return "Não informado";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("pt-BR", { currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6, style: "currency" }).format(amount)
    : value;
}

function statusTone(status: string): "danger" | "info" | "ok" | "warning" {
  if (/fail|falha|erro/i.test(status)) return "danger";
  if (/success|conclu|registrado|ok/i.test(status)) return "ok";
  if (/run|process|aguard/i.test(status)) return "info";
  return "warning";
}

import { LogsView } from "@/features/workspace-ui/portal-views";
import { auditResultLabel } from "@/features/workspace-ui/audit-result-label";
import type { AuditLog, LogClassification } from "@/features/workspace-ui/logs-explorer";
import { attachmentReference } from "@/features/internal-notes/attachment-reference";
import { prisma } from "@/server/db/prisma";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "America/Sao_Paulo",
});

function classification(
  auditResult: string | null,
  legacyClassification: string | null,
  noteStatus?: string | null,
): LogClassification {
  const label = auditResultLabel(auditResult, legacyClassification, noteStatus);
  return label === "Em análise" ? "Processamento" : label;
}

function runStatusLabel(status: string) {
  const labels: Record<string, string> = {
    FAILED: "Falhou",
    RUNNING: "Em execução",
    SUCCEEDED: "Concluída",
  };
  return labels[status] ?? status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function failureCodeLabel(code: string) {
  const labels: Record<string, string> = {
    AUDIT_INVALID_EXTRACTION: "Os dados extraídos não eram suficientes para a auditoria",
    AUDIT_INVALID_RESPONSE: "A resposta da auditoria não estava no formato esperado",
    AUDIT_PROVIDER_ERROR: "Os provedores de IA não concluíram a auditoria",
    AUDIT_TIMEOUT: "A auditoria ultrapassou o tempo limite dos modelos disponíveis",
    EXTRACTION_CONFLICT: "Houve conflito ao salvar os dados extraídos",
    EXTRACTION_INVALID_RESPONSE: "A resposta de leitura não estava no formato esperado",
    EXTRACTION_PROVIDER_ERROR: "O provedor de IA não concluiu a leitura",
    EXTRACTION_SOURCE_UNAVAILABLE: "O arquivo original não estava disponível para leitura",
    EXTRACTION_TIMEOUT: "A leitura ultrapassou o tempo limite",
  };
  return labels[code] ?? code.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return "Sem conteúdo adicional.";
  const serialized = JSON.stringify(value);
  return serialized.length > 1_500 ? `${serialized.slice(0, 1_500)}…` : serialized;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function attemptDetailLabel(value: unknown) {
  const labels: Record<string, string> = {
    "invalid-audit-envelope": "retorno do provedor incompleto",
    "invalid-audit-json": "retorno sem JSON válido",
    "invalid-audit-schema": "resposta fora do formato de auditoria",
    "provider-error": "provedor indisponível",
    "request-timeout": "tempo limite excedido",
  };
  return typeof value === "string" ? labels[value] ?? value.replaceAll("-", " ") : null;
}

function runNarrative(
  kind: string,
  status: string,
  structuredResponse: unknown,
  errorCode: string | null,
) {
  const data = asRecord(structuredResponse);
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const findingCodes = textList(data.findingCodes);
  const contextQuestionCodes = textList(data.contextQuestionCodes);
  const coverage = asRecord(data.coverage);
  const coveredAreas = textList(coverage.areas);
  const attempts = Array.isArray(data.attemptTrace)
    ? data.attemptTrace.map(asRecord)
    : [];
  const steps = attempts.map((attempt, index) => {
    const model = typeof attempt.model === "string" ? attempt.model : "modelo configurado";
    const latency = typeof attempt.latencyMs === "number"
      ? ` em ${(attempt.latencyMs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`
      : "";
    const succeeded = attempt.kind === "success";
    const detail = attemptDetailLabel(attempt.detail);
    return succeeded
      ? `Tentativa ${index + 1}: ${model} concluiu a etapa${latency}.`
      : `Tentativa ${index + 1}: ${model} não concluiu${latency}${detail ? ` (${detail})` : ""}.`;
  });

  if (kind === "EXTRACTION") {
    return {
      explanation:
        status === "FAILED"
          ? `O Harness tentou ler e normalizar o arquivo, mas a extração não foi concluída${errorCode ? `: ${failureCodeLabel(errorCode)}` : "."}`
          : "O Harness leu o arquivo, percorreu as páginas disponíveis e transformou os campos e itens identificados em dados estruturados para a auditoria.",
      steps: steps.length
        ? steps
        : ["Arquivo recebido.", "Campos e itens normalizados.", "Dados liberados para auditoria."],
    };
  }

  const auditSummary = [
    findingCodes.length
      ? `${findingCodes.length} achado(s) estruturado(s)`
      : "nenhum achado estruturado",
    contextQuestionCodes.length
      ? `${contextQuestionCodes.length} pergunta(s) de contexto`
      : "nenhuma pergunta de contexto",
    coveredAreas.length
      ? `${coveredAreas.length} área(s) conferida(s)`
      : "cobertura não detalhada",
  ].join(", ");

  return {
    explanation:
      status === "FAILED"
        ? `A auditoria aplicou as regras locais, mas não conseguiu concluir a avaliação da IA${errorCode ? `: ${failureCodeLabel(errorCode)}` : "."}`
        : summary || `O Harness aplicou regras determinísticas e a avaliação da IA: ${auditSummary}.`,
    steps: steps.length
      ? steps
      : [
          "Regras universais e parâmetros da obra conferidos.",
          "Achados livres da IA validados contra evidências.",
          "Classificação e rastreabilidade persistidas.",
        ],
  };
}

function eventCopy(type: string, dataValue: unknown) {
  const data = asRecord(dataValue);
  const fileName = typeof data.fileName === "string" ? data.fileName : "arquivo enviado";
  const findingCount = typeof data.findingCount === "number" ? data.findingCount : null;
  const map: Record<string, { action: string; comment: string; status: string }> = {
    UPLOAD_RECEIVED: {
      action: "Nota recebida pelo sistema",
      comment: `${fileName} entrou na fila de processamento.`,
      status: "Recebida",
    },
    FILE_STORED: {
      action: "Arquivo armazenado com segurança",
      comment: "O documento original foi salvo e liberado para leitura.",
      status: "Arquivo pronto",
    },
    EXTRACTION_STARTED: {
      action: "Leitura da nota iniciada",
      comment: "O Harness iniciou a extração estruturada dos campos e itens da nota.",
      status: "Extraindo dados",
    },
    EXTRACTION_COMPLETED: {
      action: "Leitura da nota concluída",
      comment: "Os dados e itens identificados foram normalizados para a auditoria.",
      status: "Extração concluída",
    },
    AUDIT_COMPLETED: {
      action: "Auditoria da nota concluída",
      comment:
        findingCount === null
          ? "As regras e a análise da IA foram concluídas."
          : `${findingCount} apontamento(s) sustentado(s) foram identificados.`,
      status: "Auditoria concluída",
    },
    READ_FAILED: {
      action: "Leitura da nota não concluída",
      comment: "O sistema não obteve dados suficientes para auditar o documento.",
      status: "Falha de leitura",
    },
    EXTRACTION_FAILED: {
      action: "Falha temporária na leitura",
      comment: "A tentativa de extração falhou e ficou registrada para diagnóstico ou reprocessamento.",
      status: "Falha na extração",
    },
    UPLOAD_FAILED: {
      action: "Falha no recebimento do arquivo",
      comment: "O upload não pôde ser finalizado e o sistema registrou a compensação.",
      status: "Falha no upload",
    },
    REPROCESS_SCHEDULED: {
      action: "Reprocessamento solicitado",
      comment: "Uma nova leitura e auditoria foram colocadas na fila.",
      status: "Reprocessando",
    },
    CONTEXT_SUBMITTED: {
      action: "Informações complementares recebidas",
      comment: "As respostas foram salvas e a nova análise foi colocada na fila.",
      status: "Reanálise solicitada",
    },
    PROCESSING_RETRY_SCHEDULED: {
      action: "Nova tentativa agendada",
      comment: "O processamento encontrou uma falha temporária e será retomado automaticamente.",
      status: "Aguardando nova tentativa",
    },
    PROCESSING_RECOVERY_SCHEDULED: {
      action: "Processamento recuperado",
      comment: "Uma execução interrompida foi identificada e recolocada na fila.",
      status: "Recuperação agendada",
    },
    AUDIT_RECOVERY_SCHEDULED: {
      action: "Auditoria recuperada",
      comment: "Os dados já extraídos foram preservados e somente a auditoria foi recolocada na fila.",
      status: "Auditoria reagendada",
    },
    WORKER_LEASE_RECOVERED: {
      action: "Execução interrompida recuperada",
      comment: "O sistema liberou uma execução antiga para que o processamento pudesse continuar.",
      status: "Processamento retomado",
    },
    PROCESSING_ATTEMPTS_EXHAUSTED: {
      action: "Processamento não concluído",
      comment: "Todas as tentativas automáticas foram usadas. O anexo pode ser reprocessado pelo administrador.",
      status: "Tentativas esgotadas",
    },
    EXTRACTION_ATTEMPT_FAILED: {
      action: "Tentativa de leitura não concluída",
      comment: "A leitura encontrou uma falha temporária e ficou registrada para nova tentativa.",
      status: "Tentativa de leitura falhou",
    },
  };
  return map[type] ?? {
    action: "Evento do processamento",
    comment: "O sistema registrou uma nova etapa da nota.",
    status: type.replaceAll("_", " ").toLocaleLowerCase("pt-BR"),
  };
}

type PageProps = {
  searchParams?: Promise<{ noteId?: string }>;
};

export default async function AdminLogsPage({ searchParams }: PageProps) {
  const requestedNoteId = (await searchParams)?.noteId;
  const noteId =
    requestedNoteId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestedNoteId,
    )
      ? requestedNoteId
      : undefined;
  const [runs, validations, administrative, events, filteredNote] = await Promise.all([
    prisma.aiRun.findMany({
      where: noteId ? { noteId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        note: {
          select: {
            auditResult: true,
            classification: true,
            documentNumber: true,
            id: true,
            status: true,
            work: { select: { name: true } },
          },
        },
      },
    }),
    prisma.validation.findMany({
      where: noteId ? { noteId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        note: {
          select: {
            auditResult: true,
            classification: true,
            documentNumber: true,
            id: true,
            status: true,
            work: { select: { name: true } },
          },
        },
        validator: { select: { email: true, fullName: true } },
      },
    }),
    prisma.adminAuditLog.findMany({
      where: noteId
        ? { entityId: noteId, entityType: "note" }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.noteEvent.findMany({
        where: noteId ? { noteId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          actor: { select: { email: true, fullName: true } },
          note: {
            select: {
              auditResult: true,
              classification: true,
              documentNumber: true,
              id: true,
              status: true,
              work: { select: { name: true } },
            },
          },
        },
    }),
    noteId
      ? prisma.note.findUnique({
          where: { id: noteId },
          select: {
            documentNumber: true,
            id: true,
            work: { select: { name: true } },
          },
        })
      : Promise.resolve(null),
  ]);

  const runLogs: AuditLog[] = runs.map((run) => {
    const narrative = runNarrative(
      run.kind,
      run.status,
      run.structuredResponse,
      run.errorCode,
    );
    return {
      action: run.kind === "EXTRACTION" ? "Extração estruturada da nota" : "Auditoria da IA",
      at: dateTime.format(run.createdAt),
      classification: classification(
        run.note.auditResult,
        run.note.classification,
        run.note.status,
      ),
      comment:
        run.status === "FAILED"
          ? "A execução não foi concluída. Consulte a falha segura e os dados técnicos abaixo."
          : `Execução ${runStatusLabel(run.status).toLocaleLowerCase("pt-BR")} pelo Harness.`,
      dateIso: run.createdAt.toISOString().slice(0, 10),
      id: `AI-${run.id}`,
      noteId: run.note.id,
      noteNumber: attachmentReference(run.note.documentNumber, run.note.id),
      reason: run.errorCode ? failureCodeLabel(run.errorCode) : `Política ${run.policyVersion}`,
      status: runStatusLabel(run.status),
      technical: {
        costUsd: run.costUsd?.toString(),
        effort: run.reasoningEffort,
        error: run.errorCode ?? undefined,
        explanation: narrative.explanation,
        latencyMs: run.latencyMs ?? undefined,
        model: run.model,
        policyVersion: run.policyVersion,
        promptVersion: run.promptVersion,
        response: safeJson(run.structuredResponse),
        steps: narrative.steps,
        tokens: run.totalTokens ?? undefined,
      },
      user: "Sistema",
      work: run.note.work.name,
    };
  });

  const validationLogs: AuditLog[] = validations.map((validation) => {
    const confirmed = validation.decision === "SUSPICION_CONFIRMED";
    return {
      action: confirmed ? "Revisor confirmou a suspeita" : "Revisor descartou a suspeita",
      at: dateTime.format(validation.createdAt),
      classification: classification(
        validation.note.auditResult,
        validation.note.classification,
        validation.note.status,
      ),
      comment: validation.comment ?? "Sem comentário adicional.",
      dateIso: validation.createdAt.toISOString().slice(0, 10),
      id: `VALIDATION-${validation.id}`,
      noteId: validation.note.id,
      noteNumber: attachmentReference(validation.note.documentNumber, validation.note.id),
      reason: validation.reason,
      status: "Decisão registrada",
      technical: { policyVersion: validation.policyVersion ?? undefined },
      user: validation.validator.fullName ?? validation.validator.email,
      work: validation.note.work.name,
    } satisfies AuditLog;
  });

  const adminLogs: AuditLog[] = administrative.map((log) => ({
    action: log.action,
    at: dateTime.format(log.createdAt),
    classification: "Processamento",
    comment: safeJson(log.data),
    dateIso: log.createdAt.toISOString().slice(0, 10),
    id: `ADMIN-${log.id}`,
    noteNumber: "Sem número",
    reason: `${log.entityType}${log.entityId ? ` · ${log.entityId}` : ""}`,
    status: "Registrado",
    user: log.actorEmail ?? "Sistema",
    work: "Administração",
  }));

  const eventLogs: AuditLog[] = events.map((event) => {
    const copy = eventCopy(event.type, event.data);
    return {
      action: copy.action,
      at: dateTime.format(event.createdAt),
      classification: classification(
        event.note.auditResult,
        event.note.classification,
        event.note.status,
      ),
      comment: copy.comment,
      dateIso: event.createdAt.toISOString().slice(0, 10),
      id: `EVENT-${event.id}`,
      noteId: event.note.id,
      noteNumber: attachmentReference(event.note.documentNumber, event.note.id),
      reason: "Linha do tempo do processamento",
      status: copy.status,
      user: event.actor?.fullName ?? event.actor?.email ?? "Sistema",
      work: event.note.work.name,
    } satisfies AuditLog;
  });

  const logs = [...eventLogs, ...runLogs, ...validationLogs, ...adminLogs]
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso) || b.at.localeCompare(a.at))
    .slice(0, 100);

  return (
    <LogsView
      logs={logs}
      noteFilterLabel={
        filteredNote
          ? `${attachmentReference(filteredNote.documentNumber, filteredNote.id)} · ${filteredNote.work.name}`
          : undefined
      }
    />
  );
}

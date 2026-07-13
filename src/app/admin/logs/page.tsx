import { LogsView } from "@/features/workspace-ui/portal-views";
import type { AuditLog, LogClassification } from "@/features/workspace-ui/logs-explorer";
import { prisma } from "@/server/db/prisma";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "America/Sao_Paulo",
});

function classification(value: string | null): LogClassification {
  if (value === "OK") return "OK";
  if (value === "SUSPICIOUS") return "Suspeita";
  if (value === "NO_PARAMETER" || value === "INCOMPATIBLE") return "Incompatível";
  return "Processamento";
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return "Sem conteúdo adicional.";
  const serialized = JSON.stringify(value);
  return serialized.length > 1_500 ? `${serialized.slice(0, 1_500)}…` : serialized;
}

export default async function AdminLogsPage() {
  const [runs, validations, administrative] = await prisma.$transaction([
    prisma.aiRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        note: {
          select: {
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
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        note: {
          select: {
            classification: true,
            documentNumber: true,
            id: true,
            work: { select: { name: true } },
          },
        },
        validator: { select: { email: true, fullName: true } },
      },
    }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const runLogs: AuditLog[] = runs.map((run) => ({
    action: run.kind === "EXTRACTION" ? "Extração estruturada da nota" : "Auditoria da IA",
    at: dateTime.format(run.createdAt),
    classification: classification(run.note.classification),
    comment: run.errorMessage ?? `Execução ${run.status.toLowerCase()} pelo Harness.`,
    dateIso: run.createdAt.toISOString().slice(0, 10),
    id: `AI-${run.id}`,
    noteId: run.note.id,
    noteNumber: run.note.documentNumber ?? "Sem número",
    reason: run.errorCode ?? `Política ${run.policyVersion}`,
    status: run.status,
    technical: {
      costUsd: run.costUsd?.toString(),
      effort: run.reasoningEffort,
      error: run.errorCode ?? undefined,
      latencyMs: run.latencyMs ?? undefined,
      model: run.model,
      policyVersion: run.policyVersion,
      promptVersion: run.promptVersion,
      response: safeJson(run.structuredResponse),
      tokens: run.totalTokens ?? undefined,
    },
    user: "Sistema",
    work: run.note.work.name,
  }));

  const validationLogs: AuditLog[] = validations.map((validation) => {
    const confirmed = validation.decision === "SUSPICION_CONFIRMED";
    return {
      action: confirmed ? "Revisor confirmou a suspeita" : "Revisor descartou a suspeita",
      at: dateTime.format(validation.createdAt),
      classification: confirmed ? "Suspeita" : "OK",
      comment: validation.comment ?? "Sem comentário adicional.",
      dateIso: validation.createdAt.toISOString().slice(0, 10),
      id: `VALIDATION-${validation.id}`,
      noteId: validation.note.id,
      noteNumber: validation.note.documentNumber ?? "Sem número",
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

  const logs = [...runLogs, ...validationLogs, ...adminLogs]
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso) || b.at.localeCompare(a.at))
    .slice(0, 100);

  return <LogsView logs={logs} />;
}

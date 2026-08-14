import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

import {
  DEMO_NOTE_ID_PATTERN,
  createDemoNoteDetail,
} from "./note-detail-demo";
import type {
  AdminNoteDetailFinding,
  LoadNoteDetailInput,
  NoteDetailBase,
  NoteDetailData,
  NoteDetailFinding,
  NoteDetailHistoryEntry,
  NoteDetailSource,
} from "./note-detail-contract";
import {
  sanitizeReviewerJson,
  sanitizeReviewerMarkdown,
  sanitizeReviewerText,
} from "./reviewer-data-policy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const noteDetailSelect = {
  aiRuns: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      attempts: true,
      completedAt: true,
      completionTokens: true,
      costUsd: true,
      createdAt: true,
      errorCode: true,
      errorMessage: true,
      id: true,
      kind: true,
      latencyMs: true,
      model: true,
      policyVersion: true,
      promptVersion: true,
      promptTokens: true,
      provider: true,
      reasoningEffort: true,
      schemaVersion: true,
      startedAt: true,
      status: true,
      structuredResponse: true,
      totalTokens: true,
    },
    take: 12,
  },
  classification: true,
  auditResult: true,
  createdAt: true,
  documentNumber: true,
  events: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      actor: { select: { email: true, fullName: true, id: true } },
      createdAt: true,
      data: true,
      fromStatus: true,
      id: true,
      toStatus: true,
      type: true,
    },
  },
  extractedData: true,
  extractionMarkdown: true,
  failureCode: true,
  failureMessage: true,
  findings: {
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      actualValue: true,
      aiRunId: true,
      category: true,
      code: true,
      confidence: true,
      createdAt: true,
      description: true,
      evidence: true,
      expectedValue: true,
      id: true,
      isNovel: true,
      justification: true,
      needsValidation: true,
      references: true,
      noteItem: {
        select: {
          code: true,
          description: true,
          id: true,
          lineNumber: true,
        },
      },
      rule: {
        select: {
          code: true,
          configuration: true,
          description: true,
          id: true,
          name: true,
        },
      },
      severity: true,
      source: true,
      status: true,
      title: true,
      ruleVersion: true,
      updatedAt: true,
    },
  },
  id: true,
  issuedAt: true,
  items: {
    orderBy: [{ lineNumber: "asc" }, { id: "asc" }],
    select: {
      code: true,
      description: true,
      id: true,
      lineNumber: true,
      quantity: true,
      rawData: true,
      totalAmount: true,
      unit: true,
      unitPrice: true,
    },
  },
  originalFileName: true,
  originalFilePath: true,
  originalMimeType: true,
  originalSizeBytes: true,
  publicProtocol: true,
  processedAt: true,
  processingStage: true,
  readConfidence: true,
  receivedAt: true,
  status: true,
  submittedBy: { select: { email: true, fullName: true, id: true } },
  supplierName: true,
  supplierTaxId: true,
  totalAmount: true,
  updatedAt: true,
  validations: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      comment: true,
      createdAt: true,
      decision: true,
      findingId: true,
      id: true,
      reason: true,
      validator: { select: { email: true, fullName: true, id: true } },
    },
  },
  version: true,
  work: {
    select: {
      active: true,
      code: true,
      id: true,
      location: true,
      name: true,
    },
  },
} as const satisfies Prisma.NoteSelect;

export async function loadNoteDetail(
  input: LoadNoteDetailInput,
): Promise<NoteDetailData | null> {
  if (DEMO_NOTE_ID_PATTERN.test(input.id)) {
    return createDemoNoteDetail(input);
  }

  if (!UUID_PATTERN.test(input.id)) return null;

  const note = await prisma.note.findUnique({
    select: noteDetailSelect,
    where: { id: input.id },
  });

  if (!note) return null;

  const forReviewer = input.role === "REVIEWER";
  const safeJson = (value: Prisma.JsonValue | null) =>
    forReviewer ? sanitizeReviewerJson(value) : value;
  const safeText = (value: string) =>
    forReviewer ? sanitizeReviewerText(value) : value;
  const documentSource: NoteDetailSource = {
    kind: "document",
    label: "Nota fiscal original enviada",
    url: null,
  };
  const visibleFindings = forReviewer
    ? note.findings.filter((finding) => finding.category !== "DOCUMENT_TYPE")
    : note.findings;
  const findings: NoteDetailFinding[] = visibleFindings.map((finding) => {
    const evidence = safeJson(finding.evidence);
    const ruleConfiguration = safeJson(finding.rule?.configuration ?? null);
    const sources = deduplicateSources([
      documentSource,
      ...(finding.rule
        ? [
            {
              kind: "rule" as const,
              label: `${finding.rule.code} — ${safeText(finding.rule.name)}`,
              url: null,
            },
          ]
        : []),
      ...extractSources(evidence, "evidence", safeText),
      ...extractSources(ruleConfiguration, "reference", safeText),
      ...extractExternalReferenceSources(
        safeJson(finding.references),
        safeText,
      ),
    ]);

    return {
      actualValue: safeJson(finding.actualValue),
      affectedItem: finding.noteItem,
      category: safeText(finding.category),
      code: finding.code,
      createdAt: finding.createdAt,
      description: safeText(finding.description),
      evidence,
      explanation: safeText(finding.justification),
      expectedValue: safeJson(finding.expectedValue),
      id: finding.id,
      needsValidation: finding.needsValidation,
      rule: finding.rule
        ? {
            code: finding.rule.code,
            description: finding.rule.description
              ? safeText(finding.rule.description)
              : null,
            id: finding.rule.id,
            name: safeText(finding.rule.name),
          }
        : null,
      severity: finding.severity,
      sources,
      status: finding.status,
      title: safeText(finding.title),
      updatedAt: finding.updatedAt,
    };
  });
  const validations: NoteDetailBase["validations"] = note.validations.map(
    (validation) => ({
      comment: validation.comment ? safeText(validation.comment) : null,
      createdAt: validation.createdAt,
      decision: validation.decision,
      findingId: validation.findingId,
      id: validation.id,
      reason: safeText(validation.reason),
      validator: validation.validator,
    }),
  );
  const history: NoteDetailHistoryEntry[] = [
    ...note.events.map((event) => ({
      actor: event.actor,
      createdAt: event.createdAt,
      data: safeJson(event.data),
      fromStatus: event.fromStatus,
      id: event.id,
      kind: "event" as const,
      label: eventLabel(event.type),
      toStatus: event.toStatus,
      type: event.type,
    })),
    ...validations.map((validation) => ({
      actor: validation.validator,
      createdAt: validation.createdAt,
      data: safeJson({
        comment: validation.comment,
        decision: validation.decision,
        findingId: validation.findingId,
        reason: validation.reason,
      }),
      fromStatus: null,
      id: `validation:${validation.id}`,
      kind: "validation" as const,
      label: "Decisão humana registrada",
      toStatus: null,
      type: "VALIDATION_RECORDED",
    })),
  ].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const rawExtraction = safeJson(note.extractedData);
  const isDemo = note.publicProtocol.startsWith("DEMO-");
  const warnings = extractionWarnings(rawExtraction).map(safeText);
  const sources = deduplicateSources([
    documentSource,
    ...findings.flatMap((finding) => finding.sources),
    ...extractSources(rawExtraction, "reference", safeText),
  ]);
  const base: NoteDetailBase = {
    analysis: {
      auditResult: note.auditResult,
      classification: note.classification,
      extractionMarkdown: forReviewer
        ? sanitizeReviewerMarkdown(note.extractionMarkdown)
        : note.extractionMarkdown,
      findings,
      rawExtraction,
      sources,
      warnings,
    },
    createdAt: note.createdAt,
    demoLabel: isDemo ? "DADOS DE DEMONSTRAÇÃO" : null,
    document: {
      fileName: note.originalFileName,
      mimeType: note.originalMimeType,
      sizeBytes: note.originalSizeBytes.toString(),
      storagePath: note.originalFilePath,
    },
    failure: {
      code: note.failureCode,
      message: note.failureMessage ? safeText(note.failureMessage) : null,
    },
    history,
    id: note.id,
    isDemo,
    issuedAt: note.issuedAt,
    items: note.items.map((item) => ({
      code: item.code,
      description: safeText(item.description),
      id: item.id,
      lineNumber: item.lineNumber,
      quantity: item.quantity?.toFixed() ?? null,
      rawData: safeJson(item.rawData),
      totalAmount: item.totalAmount?.toFixed(2) ?? null,
      unit: item.unit,
      unitPrice: item.unitPrice?.toFixed() ?? null,
    })),
    number: note.documentNumber,
    processedAt: note.processedAt,
    processingStage: note.processingStage,
    receivedAt: note.receivedAt,
    status: note.status,
    submittedBy: note.submittedBy,
    supplier: {
      name: note.supplierName,
      taxId: note.supplierTaxId,
    },
    totalAmount: note.totalAmount?.toFixed(2) ?? null,
    updatedAt: note.updatedAt,
    validations,
    version: note.version,
    work: note.work,
  };

  if (input.role === "ADMIN") {
    const adminFindings: AdminNoteDetailFinding[] = findings.map(
      (finding, index) => {
        const technical = note.findings[index];
        return {
          ...finding,
          aiRunId: technical.aiRunId,
          confidence: technical.confidence.toNumber(),
          isNovel: technical.isNovel,
          justification: technical.justification,
          references: technical.references,
          ruleVersion: technical.ruleVersion,
          source: technical.source,
        };
      },
    );
    return {
      ...base,
      analysis: {
        ...base.analysis,
        findings: adminFindings,
        readConfidence: note.readConfidence?.toNumber() ?? null,
      },
      technical: {
        aiRuns: note.aiRuns.map((run) => ({
          ...run,
          costUsd: run.costUsd?.toString() ?? null,
        })),
      },
      viewerRole: "ADMIN",
    };
  }

  return { ...base, viewerRole: "REVIEWER" };
}

function extractionWarnings(value: Prisma.JsonValue | null) {
  if (!isJsonObject(value) || !Array.isArray(value.warnings)) return [];
  return value.warnings.filter(
    (warning): warning is string => typeof warning === "string",
  );
}

function extractSources(
  value: Prisma.JsonValue | null,
  defaultKind: NoteDetailSource["kind"],
  safeText: (value: string) => string,
) {
  const sources: NoteDetailSource[] = [];
  const sourceKey = /source|fonte|reference|referencia|referência|citation|citacao|citação|url|link/i;

  function visit(current: Prisma.JsonValue | null, key = "", depth = 0) {
    if (current === null || depth > 6) return;
    if (typeof current === "string") {
      if (!sourceKey.test(key)) return;
      const label = safeText(current).trim();
      if (!label) return;
      sources.push({
        kind: defaultKind,
        label: isHttpUrl(label) ? "Referência externa" : label.slice(0, 240),
        url: isHttpUrl(label) ? label : null,
      });
      return;
    }
    if (typeof current === "number" || typeof current === "boolean") return;
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, key, depth + 1));
      return;
    }
    for (const [nestedKey, nestedValue] of Object.entries(current)) {
      if (nestedValue === undefined) continue;
      visit(nestedValue, nestedKey, depth + 1);
    }
  }

  visit(value);
  return sources;
}

function extractExternalReferenceSources(
  value: Prisma.JsonValue | null,
  safeText: (value: string) => string,
) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): NoteDetailSource[] => {
    if (typeof entry !== "string") return [];
    const url = safeText(entry).trim();
    if (!isHttpUrl(url)) return [];
    return [{ kind: "reference", label: externalSourceLabel(url), url }];
  });
}

function externalSourceLabel(url: string) {
  try {
    return `Fonte externa — ${new URL(url).hostname.replace(/^www\./, "")}`;
  } catch {
    return "Fonte externa consultada";
  }
}

function deduplicateSources(sources: NoteDetailSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.kind}:${source.label}:${source.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string) {
  return /^https?:\/\/[^\s]+$/i.test(value);
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    AUDIT_COMPLETED: "Auditoria da nota concluída",
    ANALYSIS_COMPLETED: "Análise concluída",
    EXTRACTION_COMPLETED: "Extração concluída",
    EXTRACTION_STARTED: "Leitura da nota iniciada",
    EXTRACTION_FAILED: "Falha na leitura",
    FILE_STORED: "Arquivo armazenado com segurança",
    NOTE_RECEIVED: "Nota recebida",
    PROCESSING_STARTED: "Processamento iniciado",
    READ_FAILED: "Leitura da nota não concluída",
    REPROCESS_SCHEDULED: "Reprocessamento solicitado",
    UPLOAD_FAILED: "Falha no recebimento do arquivo",
    UPLOAD_RECEIVED: "Nota recebida pelo sistema",
    VALIDATION_RECORDED: "Decisão humana registrada",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

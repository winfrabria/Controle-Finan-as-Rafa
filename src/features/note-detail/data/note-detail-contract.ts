import type { Prisma } from "@/generated/prisma/client";
import type {
  AiRunKind,
  AiRunStatus,
  AuditAssuranceBand,
  AuditFeedbackStatus,
  AuditFeedbackVerdict,
  AuditResult,
  FindingSource,
  FindingSeverity,
  FindingStatus,
  NoteClassification,
  NoteStatus,
  ProcessingStage,
  UserRole,
  ValidationDecision,
} from "@/generated/prisma/enums";

export type NoteDetailViewerRole = Extract<UserRole, "ADMIN" | "REVIEWER">;

export type NoteDetailSource = {
  kind: "document" | "evidence" | "reference" | "rule";
  label: string;
  url: string | null;
};

export type NoteDetailItem = {
  code: string | null;
  description: string;
  id: string;
  lineNumber: number;
  quantity: string | null;
  rawData: Prisma.JsonValue | null;
  totalAmount: string | null;
  unit: string | null;
  unitPrice: string | null;
};

export type NoteDetailFinding = {
  actualValue: Prisma.JsonValue | null;
  affectedItem: {
    code: string | null;
    description: string;
    id: string;
    lineNumber: number;
  } | null;
  category: string;
  code?: string;
  comparisonMode?: "REFERENCE" | "CONFLICT";
  createdAt: Date;
  description: string;
  evidence: Prisma.JsonValue | null;
  explanation: string;
  expectedValue: Prisma.JsonValue | null;
  id: string;
  needsValidation: boolean;
  referenceBasis?: string | null;
  rule: {
    code: string;
    description: string | null;
    id: string;
    name: string;
  } | null;
  severity: FindingSeverity;
  sources: NoteDetailSource[];
  status: FindingStatus;
  title: string;
  updatedAt: Date;
};

export type AdminNoteDetailFinding = NoteDetailFinding & {
  aiRunId: string | null;
  confidence: number;
  isNovel: boolean;
  justification: string;
  references: Prisma.JsonValue | null;
  ruleVersion: string | null;
  source: FindingSource;
};

export type AdminNoteAiRun = {
  attempts: number;
  completedAt: Date | null;
  completionTokens: number | null;
  costUsd: string | null;
  createdAt: Date;
  id: string;
  kind: AiRunKind;
  latencyMs: number | null;
  model: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  policyVersion: string;
  promptVersion?: string;
  promptTokens: number | null;
  provider: string | null;
  reasoningEffort: string;
  schemaVersion?: string;
  startedAt: Date;
  status: AiRunStatus;
  structuredResponse?: Prisma.JsonValue | null;
  totalTokens: number | null;
};

export type NoteDetailValidation = {
  comment: string | null;
  createdAt: Date;
  decision: ValidationDecision;
  findingId: string | null;
  id: string;
  reason: string;
  validator: {
    email: string;
    fullName: string | null;
    id: string;
  };
};

export type NoteDetailAuditFeedback = {
  comment: string | null;
  createdAt: Date;
  id: string;
  noteVersion: number;
  reasonCode: string;
  status: AuditFeedbackStatus;
  updatedAt: Date;
  verdict: AuditFeedbackVerdict;
};

export type AdminNoteDetailAuditFeedback = NoteDetailAuditFeedback & {
  actor: {
    email: string;
    fullName: string | null;
    id: string;
  };
  reviewedAt: Date | null;
  reviewedBy: {
    email: string;
    fullName: string | null;
    id: string;
  } | null;
  resolutionNote: string | null;
};

export type NoteDetailHistoryEntry = {
  actor: {
    email: string;
    fullName: string | null;
    id: string;
  } | null;
  createdAt: Date;
  data: Prisma.JsonValue | null;
  fromStatus: NoteStatus | null;
  id: string;
  kind: "event" | "validation";
  label: string;
  toStatus: NoteStatus | null;
  type: string;
};

export type NoteDetailBase = {
  analysis: {
    assurance: {
      band: AuditAssuranceBand;
      reason: string;
      version?: string;
    } | null;
    auditResult?: AuditResult | null;
    classification: NoteClassification | null;
    extractionMarkdown: string | null;
    findings: NoteDetailFinding[];
    rawExtraction: Prisma.JsonValue | null;
    sources: NoteDetailSource[];
    warnings: string[];
  };
  createdAt: Date;
  demoLabel: string | null;
  document: {
    fileName: string;
    mimeType: string;
    sizeBytes: string;
    storagePath: string;
  };
  failure: {
    code: string | null;
    message: string | null;
  };
  feedback: NoteDetailAuditFeedback | null;
  history: NoteDetailHistoryEntry[];
  id: string;
  isDemo: boolean;
  isRead: boolean;
  issuedAt: Date | null;
  items: NoteDetailItem[];
  number: string | null;
  processedAt: Date | null;
  processingStage: ProcessingStage;
  receivedAt: Date;
  status: NoteStatus;
  submittedBy: {
    email: string;
    fullName: string | null;
    id: string;
  } | null;
  supplier: {
    name: string | null;
    taxId: string | null;
  };
  totalAmount: string | null;
  updatedAt: Date;
  validations: NoteDetailValidation[];
  version: number;
  work: {
    active: boolean;
    code: string;
    id: string;
    location: string | null;
    name: string;
  };
};

export type AdminNoteDetail = Omit<NoteDetailBase, "analysis"> & {
  analysis: Omit<NoteDetailBase["analysis"], "findings"> & {
    findings: AdminNoteDetailFinding[];
    readConfidence: number | null;
  };
  technical: {
    aiRuns: AdminNoteAiRun[];
    auditFeedbacks: AdminNoteDetailAuditFeedback[];
  };
  viewerRole: "ADMIN";
};

export type ReviewerNoteDetail = NoteDetailBase & {
  viewerRole: "REVIEWER";
};

export type NoteDetailData = AdminNoteDetail | ReviewerNoteDetail;

export type LoadNoteDetailInput = {
  id: string;
  role: NoteDetailViewerRole;
  viewerId?: string;
};

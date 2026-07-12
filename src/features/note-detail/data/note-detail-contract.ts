import type { Prisma } from "@/generated/prisma/client";
import type {
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
  code: string;
  createdAt: Date;
  description: string;
  evidence: Prisma.JsonValue | null;
  expectedValue: Prisma.JsonValue | null;
  id: string;
  needsValidation: boolean;
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
  history: NoteDetailHistoryEntry[];
  id: string;
  isDemo: boolean;
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

export type AdminNoteDetail = NoteDetailBase & {
  analysis: NoteDetailBase["analysis"] & {
    readConfidence: number | null;
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
};

import { AuditResult, ContextSubmissionStatus } from "@/generated/prisma/enums";

export function statusFor(note: {
  auditResult: AuditResult | null;
  hasActiveQuestions: boolean;
  processingStage?: string;
  status: string;
  submissionStatus?: ContextSubmissionStatus;
}) {
  if (note.status === "READ_FAILED" || note.auditResult === AuditResult.READ_FAILED) {
    return "READ_FAILED" as const;
  }
  if (note.status === "FAILED") return "FAILED" as const;
  if (
    note.auditResult === AuditResult.NEEDS_CONTEXT &&
    !note.submissionStatus &&
    note.hasActiveQuestions
  ) {
    return "NEEDS_CONTEXT" as const;
  }
  if (
    note.auditResult === AuditResult.NEEDS_CONTEXT &&
    note.submissionStatus === ContextSubmissionStatus.REANALYSIS_QUEUED
  ) {
    return "PROCESSING" as const;
  }
  if (
    note.auditResult === AuditResult.NEEDS_CONTEXT &&
    note.submissionStatus === ContextSubmissionStatus.REANALYSIS_COMPLETED
  ) {
    return "COMPLETED" as const;
  }
  if (note.auditResult === AuditResult.NEEDS_CONTEXT) return "COMPLETED" as const;
  if (note.auditResult === AuditResult.OK || note.auditResult === AuditResult.SUSPICIOUS) {
    return "COMPLETED" as const;
  }
  if (note.status === "OK" && note.processingStage === "COMPLETED") {
    return "COMPLETED" as const;
  }
  return "PROCESSING" as const;
}

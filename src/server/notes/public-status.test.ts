import assert from "node:assert/strict";
import test from "node:test";

import { AuditResult, ContextSubmissionStatus } from "@/generated/prisma/enums";
import { statusFor } from "./public-status";

test("só publica NEEDS_CONTEXT quando a rodada ativa tem perguntas", () => {
  assert.equal(
    statusFor({
      auditResult: AuditResult.NEEDS_CONTEXT,
      hasActiveQuestions: true,
      status: "OK",
    }),
    "NEEDS_CONTEXT",
  );
  assert.equal(
    statusFor({
      auditResult: AuditResult.NEEDS_CONTEXT,
      hasActiveQuestions: false,
      status: "OK",
    }),
    "COMPLETED",
  );
});

test("reanálise continua genérica e termina mesmo mantendo NEEDS_CONTEXT interno", () => {
  assert.equal(
    statusFor({
      auditResult: AuditResult.NEEDS_CONTEXT,
      hasActiveQuestions: true,
      status: "PROCESSING",
      submissionStatus: ContextSubmissionStatus.REANALYSIS_QUEUED,
    }),
    "PROCESSING",
  );
  assert.equal(
    statusFor({
      auditResult: AuditResult.NEEDS_CONTEXT,
      hasActiveQuestions: true,
      status: "OK",
      submissionStatus: ContextSubmissionStatus.REANALYSIS_COMPLETED,
    }),
    "COMPLETED",
  );
});

test("nota legada concluída sem auditResult continua terminal para a capability", () => {
  assert.equal(
    statusFor({
      auditResult: null,
      hasActiveQuestions: false,
      processingStage: "COMPLETED",
      status: "OK",
    }),
    "COMPLETED",
  );
});

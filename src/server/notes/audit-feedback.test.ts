import assert from "node:assert/strict";
import test from "node:test";

import { auditFeedbackInputSchema } from "./audit-feedback-contract";

test("feedback aceita somente motivo coerente com o veredito", () => {
  assert.equal(
    auditFeedbackInputSchema.safeParse({
      comment: null,
      noteVersion: 2,
      reasonCode: "DIAGNOSIS_CONFIRMED",
      verdict: "CORRECT",
    }).success,
    true,
  );
  assert.equal(
    auditFeedbackInputSchema.safeParse({
      comment: null,
      noteVersion: 2,
      reasonCode: "MISSING_DUPLICATE",
      verdict: "CORRECT",
    }).success,
    false,
  );
});

test("problema não apontado exige descrição factual", () => {
  assert.equal(
    auditFeedbackInputSchema.safeParse({
      comment: "curto",
      noteVersion: 2,
      reasonCode: "MISSING_OTHER",
      verdict: "MISSED_ISSUE",
    }).success,
    false,
  );
  assert.equal(
    auditFeedbackInputSchema.safeParse({
      comment: "A página 2 contém outro valor divergente.",
      noteVersion: 2,
      reasonCode: "MISSING_OTHER",
      verdict: "MISSED_ISSUE",
    }).success,
    true,
  );
});

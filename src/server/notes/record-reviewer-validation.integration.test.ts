import assert from "node:assert/strict";
import test from "node:test";

import {
  recordReviewerValidation,
  ReviewerValidationDisabledError,
} from "./record-reviewer-validation";

test("decisão legada não pode criar aprovação ou rejeição no MVP", async () => {
  await assert.rejects(
    recordReviewerValidation({
      comment: "",
      decision: "SUSPEITA",
      noteId: "00000000-0000-4000-8000-000000000001",
      noteVersion: 1,
      reason: "legado",
      reviewerId: "00000000-0000-4000-8000-000000000002",
    }),
    ReviewerValidationDisabledError,
  );
});

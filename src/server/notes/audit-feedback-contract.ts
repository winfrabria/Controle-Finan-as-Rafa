import { z } from "zod";

export const AUDIT_FEEDBACK_REASON_CODES = {
  CORRECT: ["DIAGNOSIS_CONFIRMED", "EVIDENCE_CLEAR"],
  FALSE_ALERT: [
    "EVIDENCE_DOES_NOT_SUPPORT",
    "LEGITIMATE_DIFFERENCE",
    "DUPLICATE_ALERT",
  ],
  MISSED_ISSUE: [
    "MISSING_VALUE_DIVERGENCE",
    "MISSING_DATE_DIVERGENCE",
    "MISSING_DUPLICATE",
    "MISSING_OTHER",
  ],
  INSUFFICIENT_EVIDENCE: [
    "EVIDENCE_NOT_LOCATABLE",
    "DOCUMENT_COVERAGE_LIMIT",
    "EXPLANATION_INCOMPLETE",
  ],
} as const;

export const auditFeedbackInputSchema = z
  .object({
    comment: z.string().trim().max(1_000).nullable().optional(),
    noteVersion: z.number().int().positive(),
    reasonCode: z.string().trim().min(1).max(80),
    verdict: z.enum([
      "CORRECT",
      "FALSE_ALERT",
      "MISSED_ISSUE",
      "INSUFFICIENT_EVIDENCE",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed = AUDIT_FEEDBACK_REASON_CODES[value.verdict];
    if (!(allowed as readonly string[]).includes(value.reasonCode)) {
      context.addIssue({
        code: "custom",
        message: "Reason code is not allowed for this verdict.",
        path: ["reasonCode"],
      });
    }
    if (
      value.verdict === "MISSED_ISSUE" &&
      (!value.comment || value.comment.trim().length < 10)
    ) {
      context.addIssue({
        code: "custom",
        message: "Missed-issue feedback requires a short factual description.",
        path: ["comment"],
      });
    }
  });

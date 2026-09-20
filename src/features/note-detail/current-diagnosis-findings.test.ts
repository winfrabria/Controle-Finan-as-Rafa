import assert from "node:assert/strict";
import test from "node:test";
import {
  currentDiagnosisFindings,
  currentReviewerDiagnosisFindings,
} from "./current-diagnosis-findings";

test("diagnóstico atual não ressuscita nem duplica achados históricos após reprocessar", () => {
  const records = [
    { id: "old-1", code: "AMOUNT_1", status: "RESOLVED" },
    { id: "old-2", code: "AMOUNT_1", status: "FALSE_POSITIVE" },
    { id: "old-3", code: "AMOUNT_1", status: "CONFIRMED" },
    { id: "new-1", code: "AMOUNT_1", status: "OPEN" },
  ];
  assert.deepEqual(currentDiagnosisFindings(records).map((finding) => finding.id), ["new-1"]);
  assert.equal(records.length, 4);
  assert.deepEqual(currentDiagnosisFindings(records.slice(0, 3)), []);
});

test("revisor não recebe divergência antiga baseada em detalhamento parcial", () => {
  const records = [
    {
      code: "DOCUMENT_BREAKDOWN_MISMATCH_2",
      evidence: {
        comparisonMode: "CONFLICT",
        referenceBasis: null,
        requiresSourceReview: true,
      },
      id: "partial-breakdown",
      status: "OPEN",
    },
    {
      code: "EVIDENCE_AMOUNT_MISMATCH_12",
      evidence: {
        comparisonMode: "REFERENCE",
        referenceBasis: "CORROBORATED_SHEET_AND_PAYMENT",
        requiresSourceReview: true,
      },
      id: "confirmed-amount",
      status: "OPEN",
    },
  ];

  assert.deepEqual(
    currentReviewerDiagnosisFindings(records).map((finding) => finding.id),
    ["confirmed-amount"],
  );
  assert.deepEqual(
    currentDiagnosisFindings(records).map((finding) => finding.id),
    ["partial-breakdown", "confirmed-amount"],
  );
});

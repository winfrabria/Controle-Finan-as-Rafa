import { z } from "zod";

const fields = new Set(["checks", "findings", "limitations", "pageCoverage", "status", "summary", "key", "state",
  "evidence", "field", "page", "quote", "source", "findingCode", "limitationCode", "comparison", "outcome", "basis",
  "leftEvidenceIndex", "rightEvidenceIndex", "code", "title", "description", "category", "severity", "confidence",
  "justification", "references", "actualValue", "expectedValue", "noteItemLineNumber", "comparisonMode", "referenceBasis",
  "confirmsInitialFindingCode", "lineNumber", "documentRole", "documentGroup", "observations", "claimScope", "kind",
  "label", "text", "value", "checkedPages", "expectedPageCount", "missingPages"]);

/** Log contract locations only. Arbitrary keys, values, messages and model
 * content are never telemetry, even when Zod includes them in an issue. */
export function verificationSchemaDiagnostics(issues: z.core.$ZodIssue[]) {
  return { issueCount: issues.length, issues: issues.slice(0, 20).map(issue => ({
    code: issue.code,
    path: issue.path.slice(0, 12).map(part => typeof part === "number" && Number.isSafeInteger(part) && part >= 0
      ? part : typeof part === "string" && fields.has(part) ? part : "UNKNOWN_FIELD"),
  })) };
}

const safeSchema = z.object({ issueCount: z.number().int().nonnegative(), issues: z.array(z.object({
  code: z.enum(["invalid_type", "too_big", "too_small", "invalid_format", "not_multiple_of", "unrecognized_keys",
    "invalid_union", "invalid_key", "invalid_element", "invalid_value", "custom"]),
  path: z.array(z.union([z.number().int().nonnegative(), z.string().refine(value => fields.has(value) || value === "UNKNOWN_FIELD")])).max(12),
}).strict()).max(20) }).strict();

export function safeVerificationSchemaDiagnostics(value: unknown) {
  const parsed = safeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

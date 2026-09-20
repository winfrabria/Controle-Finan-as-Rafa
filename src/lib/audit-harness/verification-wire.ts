import { z } from "zod";
import { VERIFICATION_JSON_SCHEMA, verificationCheckSchema, verificationFindingSchema, verificationResponseSchema, type VerificationCheckRequest } from "./verification";

const checkFields = verificationCheckSchema.shape;
const compactCheckSchema = z.object({
  key: checkFields.key,
  state: checkFields.state,
  evidence: checkFields.evidence,
  findingCode: checkFields.findingCode,
  limitationCode: checkFields.limitationCode,
  comparison: checkFields.comparison,
}).strict();
const compactResponseSchema = z.object({
  ...verificationResponseSchema.shape,
  checks: z.array(compactCheckSchema).max(300),
}).strict();
const checkProperties = VERIFICATION_JSON_SCHEMA.properties.checks.items.properties;

/** The model supplies evidence and a verdict, not copies of server-owned IDs. */
export const VERIFICATION_WIRE_JSON_SCHEMA = {
  ...VERIFICATION_JSON_SCHEMA,
  properties: {
    ...VERIFICATION_JSON_SCHEMA.properties,
    checks: {
      ...VERIFICATION_JSON_SCHEMA.properties.checks,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "state", "evidence", "findingCode", "limitationCode", "comparison"],
        properties: {
          key: checkProperties.key,
          state: checkProperties.state,
          evidence: checkProperties.evidence,
          findingCode: checkProperties.findingCode,
          limitationCode: checkProperties.limitationCode,
          comparison: checkProperties.comparison,
        },
      },
    },
  },
} as const;

export function parseVerificationWirePayload(payload: unknown, expectedChecks: VerificationCheckRequest[]) {
  // Local page references are redundant with validated original-document
  // evidence. Materialize that display metadata, never an external source or
  // authorization rule. All other finding constraints remain unchanged.
  if (payload && typeof payload === "object" && !Array.isArray(payload) &&
    "findings" in payload && Array.isArray(payload.findings)) {
    payload = { ...payload, findings: payload.findings.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value) ||
        !Array.isArray(value.references) || value.references.length !== 0 ||
        !value.evidence || typeof value.evidence !== "object" || value.evidence.claimScope !== "DOCUMENT_CONTENT") return value;
      const pages = [value.evidence.page, ...(Array.isArray(value.evidence.observations)
        ? value.evidence.observations.map((source: { page?: unknown } | null) => source?.page) : [])];
      if (!pages.length || pages.some(page => !Number.isSafeInteger(page) || page < 1)) return value;
      const candidate = { ...value, references: [...new Set<number>(pages)].sort((a, b) => a - b).map(page => `Documento original · página ${page}`) };
      return verificationFindingSchema.safeParse(candidate).success ? candidate : value;
    }) };
  }
  const expectedByKey = new Map(expectedChecks.map((check) => [check.key, check]));
  const parsed = compactResponseSchema.superRefine((response, context) => {
    const seen = new Set<string>();
    response.checks.forEach((check, index) => {
      if (!expectedByKey.has(check.key) || seen.has(check.key)) {
        context.addIssue({ code: "custom", path: ["checks", index, "key"], message: "Check must have a unique expected key." });
      }
      seen.add(check.key);
    });
  }).safeParse(payload);
  if (!parsed.success) return parsed;
  // Missing checks are NOT filled in. Coverage validation still requires the
  // complete set, every page and locatable evidence. Legacy storage stays full.
  return verificationResponseSchema.safeParse({
    ...parsed.data,
    checks: parsed.data.checks.map((check) => {
      const expected = expectedByKey.get(check.key)!;
      return { documentGroup: expected.documentGroup, documentRole: expected.documentRole,
        lineNumber: expected.lineNumber, ...check };
    }),
  });
}

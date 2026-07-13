import { z } from "zod";

export const harnessClassificationSchema = z.enum([
  "OK",
  "SUSPICIOUS",
  "NO_PARAMETER",
  "READ_FAILED",
]);

export const harnessFindingSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(2_000),
    category: z.string().trim().min(1).max(100),
    severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
    source: z.enum(["UNIVERSAL_RULE", "WORK_RULE", "AI_DISCOVERY"]),
    confidence: z.number().min(0).max(1),
    justification: z.string().trim().min(1).max(2_000),
    references: z.array(z.string().trim().min(1).max(500)).max(20),
    evidence: z.record(z.string(), z.unknown()),
    expectedValue: z.unknown().nullable(),
    actualValue: z.unknown().nullable(),
    noteItemLineNumber: z.number().int().positive().nullable(),
  })
  .strict();

export const aiDiscoveryResponseSchema = z
  .object({
    findings: z.array(
      harnessFindingSchema.extend({
        source: z.literal("AI_DISCOVERY"),
      }),
    ).max(50),
    coverage: z
      .object({
        sufficientEvidence: z.boolean(),
        checkedAreas: z.array(z.string().trim().min(1)).max(30),
        limitations: z.array(z.string().trim().min(1)).max(30),
      })
      .strict(),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const AI_DISCOVERY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "coverage", "summary"],
  properties: {
    findings: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "code", "title", "description", "category", "severity", "source",
          "confidence", "justification", "evidence", "expectedValue",
          "actualValue", "noteItemLineNumber", "references",
        ],
        properties: {
          code: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] },
          source: { type: "string", const: "AI_DISCOVERY" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          justification: { type: "string" },
          references: {
            type: "array",
            items: { type: "string" },
            maxItems: 20,
          },
          evidence: { type: "object", additionalProperties: true },
          expectedValue: {},
          actualValue: {},
          noteItemLineNumber: { type: ["integer", "null"], minimum: 1 },
        },
      },
    },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: ["sufficientEvidence", "checkedAreas", "limitations"],
      properties: {
        sufficientEvidence: { type: "boolean" },
        checkedAreas: { type: "array", items: { type: "string" }, maxItems: 30 },
        limitations: { type: "array", items: { type: "string" }, maxItems: 30 },
      },
    },
    summary: { type: "string" },
  },
} as const;

export type HarnessClassification = z.infer<typeof harnessClassificationSchema>;
export type HarnessFinding = z.infer<typeof harnessFindingSchema>;
export type AiDiscoveryResponse = z.infer<typeof aiDiscoveryResponseSchema>;

export type HarnessInvoice = {
  documentNumber: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  issuedAt: string | null;
  totalAmount: string | null;
  readConfidence: number;
  warnings: string[];
  markdown: string;
  items: Array<{
    lineNumber: number;
    description: string;
    quantity: string | null;
    unitPrice: string | null;
    totalAmount: string | null;
  }>;
};

export type WorkRuleInput = {
  code: string;
  name: string;
  category: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  configuration: unknown;
};

export type DuplicateCandidate = {
  noteId: string;
  documentNumber: string | null;
  supplierTaxId: string | null;
  issuedAt: string | null;
  totalAmount: string | null;
};

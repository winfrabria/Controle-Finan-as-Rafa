import { z } from "zod";

export const harnessClassificationSchema = z.enum([
  "OK",
  "SUSPICIOUS",
  "NEEDS_CONTEXT",
  "READ_FAILED",
]);

const contextQuestionOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(80),
  })
  .strict();

export const contextQuestionSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    options: z.array(contextQuestionOptionSchema).max(10),
    prompt: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(1_000),
    required: z.boolean(),
    type: z.enum(["TEXT", "NUMBER", "SINGLE_SELECT", "BOOLEAN"]),
  })
  .strict()
  .superRefine((question, context) => {
    const values = question.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "Question options must be unique.",
        path: ["options"],
      });
    }
    if (question.type === "SINGLE_SELECT" && question.options.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Single-select questions need at least two options.",
        path: ["options"],
      });
    }
    if (question.type !== "SINGLE_SELECT" && question.options.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Only single-select questions may provide options.",
        path: ["options"],
      });
    }
  });

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
    // Composite reimbursements may reference many receipts/pages in a single
    // supported finding. Keep the bound defensive without rejecting valid
    // evidence from large documents.
    references: z.array(z.string().trim().min(1).max(500)).max(100),
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
    contextQuestions: z.array(contextQuestionSchema).max(3),
    needsContext: z.boolean(),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((value, context) => {
    // A reanalysis may still conclude that context is insufficient after the
    // single public round. The pipeline enforces questions on the first pass.
    if (!value.needsContext && value.contextQuestions.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Context questions require needsContext=true.",
        path: ["contextQuestions"],
      });
    }
  });

export const AI_DISCOVERY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "coverage", "needsContext", "contextQuestions", "summary"],
  properties: {
    findings: {
      type: "array",
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
          source: { type: "string", enum: ["AI_DISCOVERY"] },
          confidence: { type: "number" },
          justification: { type: "string" },
          references: {
            type: "array",
            maxItems: 100,
            items: { type: "string" },
          },
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "field", "source", "page", "lineNumber"],
            properties: {
              summary: { type: "string" },
              field: { type: ["string", "null"] },
              source: { type: ["string", "null"] },
              page: { type: ["integer", "null"] },
              lineNumber: { type: ["integer", "null"] },
            },
          },
          expectedValue: { type: ["string", "null"] },
          actualValue: { type: ["string", "null"] },
          noteItemLineNumber: { type: ["integer", "null"] },
        },
      },
    },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: ["sufficientEvidence", "checkedAreas", "limitations"],
      properties: {
        sufficientEvidence: { type: "boolean" },
        checkedAreas: { type: "array", items: { type: "string" } },
        limitations: { type: "array", items: { type: "string" } },
      },
    },
    needsContext: { type: "boolean" },
    contextQuestions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "options", "prompt", "rationale", "required", "type"],
        properties: {
          code: { type: "string", minLength: 1, maxLength: 80 },
          options: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 160 },
                value: { type: "string", minLength: 1, maxLength: 80 },
              },
            },
          },
          prompt: { type: "string", minLength: 1, maxLength: 500 },
          rationale: { type: "string", minLength: 1, maxLength: 1000 },
          required: { type: "boolean" },
          type: { type: "string", enum: ["TEXT", "NUMBER", "SINGLE_SELECT", "BOOLEAN"] },
        },
      },
    },
    summary: { type: "string" },
  },
} as const;

export type HarnessClassification = z.infer<typeof harnessClassificationSchema>;
export type HarnessFinding = z.infer<typeof harnessFindingSchema>;
export type AiDiscoveryResponse = z.infer<typeof aiDiscoveryResponseSchema>;
export type ContextQuestion = z.infer<typeof contextQuestionSchema>;

export type ContextAnswerForAudit = {
  code: string;
  question: string;
  type: ContextQuestion["type"];
  value: string | number | boolean;
};

export type HarnessInvoice = {
  documentKind?:
    | "FISCAL_INVOICE"
    | "REIMBURSEMENT"
    | "COMPOSITE"
    | "PAYMENT_PROOF"
    | "OTHER";
  documentNumber: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  issuedAt: string | null;
  totalAmount: string | null;
  readConfidence: number;
  warnings: string[];
  markdown: string;
  requiredFieldChecks?: Array<{
    field: string;
    label: string;
    requiredByDocument: boolean;
    present: boolean;
    page: number | null;
    evidence: string | null;
  }>;
  items: Array<{
    lineNumber: number;
    description: string;
    documentGroup?: string | null;
    documentRole?:
      | "LINE_ITEM"
      | "AGGREGATE_PAYMENT"
      | "SUPPORTING_DOCUMENT"
      | "SUMMARY";
    countsTowardDocumentTotal?: boolean;
    quantity: string | null;
    unitPrice: string | null;
    totalAmount: string | null;
    evidenceObservations?: Array<{
      kind: "SHEET" | "RECEIPT" | "SALE" | "PAYMENT" | "DISCOUNT" | "OTHER";
      documentGroup?: string | null;
      label: string | null;
      amount: string | null;
      date: string | null;
      page: number | null;
      text: string | null;
    }>;
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

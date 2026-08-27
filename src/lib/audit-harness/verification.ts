import { z } from "zod";

import type {
  HarnessClassification,
  HarnessFinding,
  HarnessInvoice,
} from "./contracts";
import { isSupportedFinding } from "./decision-matrix";
import type { HarnessVerifierMode } from "./versions";

export const auditAssuranceBandSchema = z.enum(["HIGH", "MEDIUM", "LIMITED"]);

export const verificationEvidenceSchema = z
  .object({
    field: z.string().trim().min(1).max(200).nullable(),
    page: z.number().int().positive(),
    quote: z.string().trim().min(1).max(500),
    source: z.string().trim().min(1).max(240),
  })
  .strict();

export const verificationCheckSchema = z
  .object({
    documentGroup: z.string().trim().min(1).max(160).nullable(),
    documentRole: z
      .enum([
        "LINE_ITEM",
        "AGGREGATE_PAYMENT",
        "SUPPORTING_DOCUMENT",
        "SUMMARY",
      ])
      .nullable(),
    evidence: z.array(verificationEvidenceSchema).max(20),
    findingCode: z.string().trim().min(1).max(100).nullable(),
    key: z.string().trim().min(1).max(160),
    limitationCode: z.string().trim().min(1).max(100).nullable(),
    lineNumber: z.number().int().positive().nullable(),
    state: z.enum(["VERIFIED", "FINDING", "LIMITATION"]),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.state === "FINDING" && (!check.findingCode || check.evidence.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Finding checks require a findingCode and concrete evidence.",
      });
    }
    if (check.state === "LIMITATION" && !check.limitationCode) {
      context.addIssue({
        code: "custom",
        message: "Limitation checks require a limitationCode.",
      });
    }
  });

const verificationFindingEvidenceSchema = z
  .object({
    field: z.string().trim().min(1).max(200),
    lineNumber: z.number().int().positive().nullable(),
    page: z.number().int().positive(),
    source: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const verificationFindingSchema = z
  .object({
    actualValue: z.string().trim().max(1_000).nullable(),
    category: z.string().trim().min(1).max(100),
    code: z.string().trim().min(1).max(100),
    confidence: z.number().min(0).max(1),
    description: z.string().trim().min(1).max(2_000),
    evidence: verificationFindingEvidenceSchema,
    expectedValue: z.string().trim().max(1_000).nullable(),
    justification: z.string().trim().min(1).max(2_000),
    noteItemLineNumber: z.number().int().positive().nullable(),
    references: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
    source: z.literal("AI_VERIFICATION"),
    title: z.string().trim().min(1).max(180),
  })
  .strict();

export const verificationResponseSchema = z
  .object({
    checks: z.array(verificationCheckSchema).max(300),
    findings: z.array(verificationFindingSchema).max(50),
    limitations: z.array(z.string().trim().min(1).max(500)).max(50),
    pageCoverage: z
      .object({
        checkedPages: z.array(z.number().int().positive()).max(500),
        expectedPageCount: z.number().int().positive().nullable(),
        missingPages: z.array(z.number().int().positive()).max(500),
        status: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
      })
      .strict(),
    status: z.enum(["PASS", "FINDINGS", "LIMITED"]),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "PASS" && (value.findings.length > 0 || value.limitations.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "PASS cannot contain findings or limitations.",
        path: ["status"],
      });
    }
    if (value.status === "FINDINGS" && value.findings.length === 0) {
      context.addIssue({
        code: "custom",
        message: "FINDINGS requires at least one finding.",
        path: ["findings"],
      });
    }
    if (
      value.status === "LIMITED" &&
      value.limitations.length === 0 &&
      value.pageCoverage.status === "COMPLETE" &&
      value.checks.every((check) => check.state !== "LIMITATION")
    ) {
      context.addIssue({
        code: "custom",
        message: "LIMITED requires a declared limitation.",
        path: ["limitations"],
      });
    }
  });

export const VERIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "pageCoverage", "checks", "findings", "limitations", "summary"],
  properties: {
    status: { type: "string", enum: ["PASS", "FINDINGS", "LIMITED"] },
    pageCoverage: {
      type: "object",
      additionalProperties: false,
      required: ["status", "expectedPageCount", "checkedPages", "missingPages"],
      properties: {
        status: { type: "string", enum: ["COMPLETE", "INCOMPLETE", "UNKNOWN"] },
        expectedPageCount: { type: ["integer", "null"], minimum: 1 },
        checkedPages: { type: "array", maxItems: 500, items: { type: "integer", minimum: 1 } },
        missingPages: { type: "array", maxItems: 500, items: { type: "integer", minimum: 1 } },
      },
    },
    checks: {
      type: "array",
      maxItems: 300,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "documentGroup", "lineNumber", "documentRole", "state", "evidence", "findingCode", "limitationCode"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 160 },
          documentGroup: { type: ["string", "null"], minLength: 1, maxLength: 160 },
          lineNumber: { type: ["integer", "null"], minimum: 1 },
          documentRole: { type: ["string", "null"], enum: ["LINE_ITEM", "AGGREGATE_PAYMENT", "SUPPORTING_DOCUMENT", "SUMMARY", null] },
          state: { type: "string", enum: ["VERIFIED", "FINDING", "LIMITATION"] },
          evidence: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["page", "field", "quote", "source"],
              properties: {
                page: { type: "integer", minimum: 1 },
                field: { type: ["string", "null"], minLength: 1, maxLength: 200 },
                quote: { type: "string", minLength: 1, maxLength: 500 },
                source: { type: "string", minLength: 1, maxLength: 240 },
              },
            },
          },
          findingCode: { type: ["string", "null"], minLength: 1, maxLength: 100 },
          limitationCode: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        },
      },
    },
    findings: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "title", "description", "category", "severity", "source", "confidence", "justification", "references", "evidence", "expectedValue", "actualValue", "noteItemLineNumber"],
        properties: {
          code: { type: "string", minLength: 1, maxLength: 100 },
          title: { type: "string", minLength: 1, maxLength: 180 },
          description: { type: "string", minLength: 1, maxLength: 2000 },
          category: { type: "string", minLength: 1, maxLength: 100 },
          severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] },
          source: { type: "string", enum: ["AI_VERIFICATION"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          justification: { type: "string", minLength: 1, maxLength: 2000 },
          references: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", minLength: 1, maxLength: 500 } },
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "field", "source", "page", "lineNumber"],
            properties: {
              summary: { type: "string", minLength: 1, maxLength: 2000 },
              field: { type: "string", minLength: 1, maxLength: 200 },
              source: { type: "string", minLength: 1, maxLength: 500 },
              page: { type: "integer", minimum: 1 },
              lineNumber: { type: ["integer", "null"], minimum: 1 },
            },
          },
          expectedValue: { type: ["string", "null"], maxLength: 1000 },
          actualValue: { type: ["string", "null"], maxLength: 1000 },
          noteItemLineNumber: { type: ["integer", "null"], minimum: 1 },
        },
      },
    },
    limitations: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 500 } },
    summary: { type: "string", minLength: 1, maxLength: 4000 },
  },
} as const;

export type VerificationResponse = z.infer<typeof verificationResponseSchema>;
export type AuditAssuranceBand = z.infer<typeof auditAssuranceBandSchema>;

export type VerificationCheckRequest = {
  documentGroup: string | null;
  documentRole: HarnessInvoice["items"][number]["documentRole"] | null;
  key: string;
  lineNumber: number | null;
};

export type VerificationSelection = {
  required: boolean;
  reasons: string[];
};

export function canRetainSuspiciousAfterVerificationFailure(input: {
  classification: HarnessClassification;
  findings: HarnessFinding[];
}) {
  return (
    input.classification === "SUSPICIOUS" &&
    input.findings.some(
      (finding) => finding.severity !== "INFO" && isSupportedFinding(finding),
    )
  );
}

export function buildVerificationChecks(
  invoice: HarnessInvoice,
): VerificationCheckRequest[] {
  const itemChecks = invoice.items.slice(0, 297).map((item) => ({
    documentGroup: item.documentGroup ?? null,
    documentRole: item.documentRole ?? null,
    key: `line:${item.lineNumber}`,
    lineNumber: item.lineNumber,
  }));
  return [
    { documentGroup: null, documentRole: null, key: "document:coverage", lineNumber: null },
    { documentGroup: null, documentRole: null, key: "document:total", lineNumber: null },
    ...itemChecks,
    ...(invoice.items.length > itemChecks.length
      ? [{
          documentGroup: null,
          documentRole: null,
          key: "document:item-check-overflow",
          lineNumber: null,
        } as const]
      : []),
  ];
}

export function selectVerification(input: {
  aiCoverage: boolean;
  baseClassification: HarnessClassification;
  baseFindings: HarnessFinding[];
  extractionAttempts?: number;
  extractionRecovered?: boolean;
  invoice: HarnessInvoice;
  pageCount?: number | null;
}): VerificationSelection {
  if (input.baseClassification === "READ_FAILED") {
    return { required: false, reasons: [] };
  }

  const reasons: string[] = [];
  const kind = input.invoice.documentKind;
  if (kind === "REIMBURSEMENT" || kind === "COMPOSITE") reasons.push("COMPOSITE_DOCUMENT");
  if ((input.pageCount ?? 0) >= 5) reasons.push("LONG_DOCUMENT");
  if (
    (kind === "FISCAL_INVOICE" || kind === "REIMBURSEMENT" || kind === "COMPOSITE") &&
    input.invoice.itemCoverage?.status !== "COMPLETE"
  ) reasons.push("ITEM_COVERAGE_NOT_COMPLETE");
  if (input.invoice.readConfidence >= 0.6 && input.invoice.readConfidence <= 0.75) {
    reasons.push("LOW_READABLE_CONFIDENCE");
  }
  if (input.invoice.warnings.length >= 3) reasons.push("MULTIPLE_EXTRACTION_WARNINGS");
  if ((input.extractionAttempts ?? 1) > 1 || input.extractionRecovered) reasons.push("RECOVERED_EXTRACTION");
  const total = input.invoice.totalAmount === null ? null : Number(input.invoice.totalAmount);
  if (total !== null && Number.isFinite(total) && total >= 50_000) reasons.push("HIGH_VALUE");
  if (
    input.baseClassification === "SUSPICIOUS" &&
    input.baseFindings.length > 0 &&
    input.baseFindings.every((finding) => finding.source === "AI_DISCOVERY")
  ) reasons.push("AI_ONLY_SUSPICION");
  if (!input.aiCoverage || input.baseClassification === "NEEDS_CONTEXT" || input.baseClassification === "INFORMATION_INSUFFICIENT") {
    reasons.push("INSUFFICIENT_AUDIT_COVERAGE");
  }

  return { required: reasons.length > 0, reasons: [...new Set(reasons)] };
}

export function validateVerificationCoverage(input: {
  expectedChecks: VerificationCheckRequest[];
  expectedPageCount: number | null;
  response: VerificationResponse;
}) {
  const expectedKeys = new Set(input.expectedChecks.map((check) => check.key));
  const receivedKeys = input.response.checks.map((check) => check.key);
  const duplicateKeys = receivedKeys.filter((key, index) => receivedKeys.indexOf(key) !== index);
  const unknownKeys = receivedKeys.filter((key) => !expectedKeys.has(key));
  const missingKeys = [...expectedKeys].filter((key) => !receivedKeys.includes(key));
  const expectedPages = input.expectedPageCount
    ? Array.from({ length: input.expectedPageCount }, (_, index) => index + 1)
    : [];
  const checked = new Set(input.response.pageCoverage.checkedPages);
  const missingPages = expectedPages.filter((page) => !checked.has(page));
  const findingCodes = new Set(input.response.findings.map((finding) => finding.code));
  const checkFindingCodes = new Set(
    input.response.checks.flatMap((check) =>
      check.state === "FINDING" && check.findingCode ? [check.findingCode] : [],
    ),
  );
  const unlinkedFindingCodes = [...findingCodes].filter(
    (code) => !checkFindingCodes.has(code),
  );
  const orphanCheckFindingCodes = [...checkFindingCodes].filter(
    (code) => !findingCodes.has(code),
  );
  const hasLimitationCheck = input.response.checks.some(
    (check) => check.state === "LIMITATION",
  );
  const hasOverflow = expectedKeys.has("document:item-check-overflow");
  const complete =
    duplicateKeys.length === 0 &&
    unknownKeys.length === 0 &&
    missingKeys.length === 0 &&
    unlinkedFindingCodes.length === 0 &&
    orphanCheckFindingCodes.length === 0 &&
    !hasLimitationCheck &&
    !hasOverflow &&
    input.expectedPageCount !== null &&
    input.response.pageCoverage.status === "COMPLETE" &&
    input.response.pageCoverage.expectedPageCount === input.expectedPageCount &&
    input.response.pageCoverage.missingPages.length === 0 &&
    missingPages.length === 0;

  return {
    complete,
    duplicateKeys,
    missingKeys,
    missingPages,
    orphanCheckFindingCodes,
    unknownKeys,
    unlinkedFindingCodes,
  };
}

export function resolveAuditAssurance(input: {
  aiCoverage: boolean;
  classification: HarnessClassification;
  mode: HarnessVerifierMode;
  selection: VerificationSelection;
  verificationCoverageComplete?: boolean;
  verificationStatus?: VerificationResponse["status"] | "FAILED" | "NOT_RUN";
}): { band: AuditAssuranceBand; reason: string } {
  if (input.classification === "READ_FAILED") {
    return { band: "LIMITED", reason: "O arquivo não permitiu uma leitura confiável." };
  }
  if (input.selection.required && input.mode === "off") {
    return { band: "LIMITED", reason: "O anexo possui fatores de risco que ainda não passaram pela verificação independente." };
  }
  if (
    input.selection.required &&
    input.mode === "shadow" &&
    (input.verificationStatus === "FAILED" || input.verificationStatus === "LIMITED")
  ) {
    return { band: "LIMITED", reason: "A medição independente não conseguiu cobrir todo o anexo." };
  }
  if (input.selection.required && input.mode === "shadow") {
    return { band: "MEDIUM", reason: "A verificação independente foi executada apenas para medição e não alterou o diagnóstico." };
  }
  if (
    input.selection.required &&
    (input.verificationStatus === "FAILED" ||
      input.verificationStatus === "LIMITED" ||
      !input.verificationCoverageComplete)
  ) {
    return { band: "LIMITED", reason: "A verificação independente não conseguiu cobrir todo o anexo." };
  }
  if (
    input.classification === "NEEDS_CONTEXT" ||
    input.classification === "INFORMATION_INSUFFICIENT"
  ) {
    return {
      band: "MEDIUM",
      reason: "O anexo foi conferido, mas ainda falta informação essencial para uma conclusão completa.",
    };
  }
  if (input.selection.required && input.verificationStatus === "PASS" && input.verificationCoverageComplete) {
    return { band: "HIGH", reason: "O diagnóstico passou por uma segunda verificação independente com cobertura completa." };
  }
  if (input.selection.required && input.verificationStatus === "FINDINGS" && input.verificationCoverageComplete) {
    return { band: "HIGH", reason: "Uma segunda verificação independente confirmou ou acrescentou evidência concreta ao diagnóstico." };
  }
  if (input.aiCoverage) {
    return { band: "HIGH", reason: "As regras e a auditoria cobriram os dados disponíveis sem limitação material." };
  }
  return { band: "MEDIUM", reason: "O diagnóstico é conclusivo para a evidência disponível, com cobertura parcial declarada." };
}

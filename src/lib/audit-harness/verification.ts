import { z } from "zod";

import type {
  HarnessClassification,
  HarnessFinding,
  HarnessInvoice,
} from "./contracts";
import { isSupportedFinding } from "./decision-matrix";
import { hasUncertainSupportCoverage } from "./policy";
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
    // Older verification runs were persisted before the explicit hypothesis
    // link existed. Treat the missing field as an unlinked finding so those
    // runs remain readable without weakening the new provider contract.
    confirmsInitialFindingCode: z.string().trim().min(1).max(100).nullable().default(null),
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
          required: ["code", "confirmsInitialFindingCode", "title", "description", "category", "severity", "source", "confidence", "justification", "references", "evidence", "expectedValue", "actualValue", "noteItemLineNumber"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 100 },
            confirmsInitialFindingCode: { type: ["string", "null"], minLength: 1, maxLength: 100 },
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
export type VerificationFinding = z.infer<typeof verificationFindingSchema>;
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

const FINANCIAL_OR_DATE_FINDING_PATTERN =
  /(?:^|[^a-z])(?:amounts?|totals?|prices?|values?|valor(?:es)?|preco(?:s)?|payment|pagamento|billing|fatura|cobranca|arithmetic|quantity|data|datas|dates?|periodo|period|emissao|issued|vencimento|due)(?:$|[^a-z])/u;

function normalizedSemanticText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function comparableClaimValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `money:${value.toFixed(2)}`;
  }
  if (typeof value !== "string") return normalizedSemanticText(JSON.stringify(value));

  const text = value.trim();
  const date = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/u);
  if (date) {
    const year = date[3].length === 2 ? `20${date[3]}` : date[3];
    return `date:${year}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
  }
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
  if (isoDate) {
    return `date:${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}`;
  }

  const compact = text
    .replace(/^R\$\s*/iu, "")
    .replace(/\s+/g, "");
  if (/^-?[\d.,]+$/u.test(compact)) {
    const lastComma = compact.lastIndexOf(",");
    const lastDot = compact.lastIndexOf(".");
    let normalized = compact;
    if (lastComma >= 0 && lastDot >= 0) {
      normalized = lastComma > lastDot
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "");
    } else if (lastComma >= 0 || lastDot >= 0) {
      const separator = lastComma >= 0 ? "," : ".";
      const parts = compact.split(separator);
      const trailingDigits = parts.at(-1)?.length ?? 0;
      if (trailingDigits === 3 && parts.slice(1).every((part) => part.length === 3)) {
        normalized = parts.join("");
      } else if (trailingDigits >= 1 && trailingDigits <= 2) {
        normalized = `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
      }
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return `money:${parsed.toFixed(2)}`;
  }

  return `text:${normalizedSemanticText(text)}`;
}

function claimPairMatches(
  initial: Pick<HarnessFinding, "actualValue" | "expectedValue">,
  verification: Pick<VerificationFinding, "actualValue" | "expectedValue">,
) {
  const initialValues = [
    comparableClaimValue(initial.expectedValue),
    comparableClaimValue(initial.actualValue),
  ];
  const verificationValues = [
    comparableClaimValue(verification.expectedValue),
    comparableClaimValue(verification.actualValue),
  ];
  if (
    initialValues.some((value) => value === null) ||
    verificationValues.some((value) => value === null)
  ) return false;
  return initialValues.sort().join("|") === verificationValues.sort().join("|");
}

export function requiresIndependentAiConfirmation(finding: HarnessFinding) {
  if (finding.source !== "AI_DISCOVERY" || finding.severity === "INFO") return false;
  const evidenceField = typeof finding.evidence.field === "string"
    ? finding.evidence.field
    : "";
  const semanticIdentity = normalizedSemanticText(
    `${finding.code} ${finding.category} ${evidenceField}`,
  );
  if (FINANCIAL_OR_DATE_FINDING_PATTERN.test(semanticIdentity)) return true;

  const expected = comparableClaimValue(finding.expectedValue);
  const actual = comparableClaimValue(finding.actualValue);
  return (
    expected !== null &&
    actual !== null &&
    ((expected.startsWith("money:") && actual.startsWith("money:")) ||
      (expected.startsWith("date:") && actual.startsWith("date:")))
  );
}

export function explicitlyConfirmedVerificationFindings(
  initialFindings: HarnessFinding[],
  verificationFindings: VerificationFinding[],
) {
  return verificationFindings.filter((verification) => {
    if (
      verification.severity === "INFO" ||
      !verification.confirmsInitialFindingCode ||
      !isSupportedFinding(verification)
    ) return false;
    return initialFindings.some(
      (initial) =>
        requiresIndependentAiConfirmation(initial) &&
        initial.code === verification.confirmsInitialFindingCode &&
        initial.code === verification.code &&
        claimPairMatches(initial, verification),
    );
  });
}

export function isAiDiscoveryFindingExplicitlyConfirmed(
  finding: HarnessFinding,
  verificationFindings: VerificationFinding[],
) {
  return explicitlyConfirmedVerificationFindings(
    [finding],
    verificationFindings,
  ).length > 0;
}

export function canRetainSuspiciousAfterVerificationFailure(input: {
  classification: HarnessClassification;
  findings: HarnessFinding[];
}) {
  return (
    input.classification === "SUSPICIOUS" &&
    input.findings.some(
      (finding) =>
        finding.severity !== "INFO" &&
        isSupportedFinding(finding) &&
        !requiresIndependentAiConfirmation(finding),
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
  if (hasUncertainSupportCoverage(input.invoice)) reasons.push("SUPPORT_COVERAGE_NOT_COMPLETE");
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
  if (input.baseFindings.some(requiresIndependentAiConfirmation)) {
    reasons.push("AI_FINANCIAL_OR_DATE_CONFIRMATION_REQUIRED");
  }
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
  initialFindings?: HarnessFinding[];
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
  const invalidFindingPages = input.response.findings
    .filter(
      (finding) =>
        input.expectedPageCount !== null &&
        finding.evidence.page > input.expectedPageCount,
    )
    .map((finding) => finding.code);
  const invalidConfirmationCodes = input.response.findings
    .filter(
      (finding) =>
        finding.confirmsInitialFindingCode !== null &&
        explicitlyConfirmedVerificationFindings(
          input.initialFindings ?? [],
          [finding],
        ).length === 0,
    )
    .map((finding) => finding.confirmsInitialFindingCode as string);
  const complete =
    duplicateKeys.length === 0 &&
    unknownKeys.length === 0 &&
    missingKeys.length === 0 &&
    unlinkedFindingCodes.length === 0 &&
    orphanCheckFindingCodes.length === 0 &&
    !hasLimitationCheck &&
    !hasOverflow &&
    invalidFindingPages.length === 0 &&
    invalidConfirmationCodes.length === 0 &&
    input.expectedPageCount !== null &&
    input.response.pageCoverage.status === "COMPLETE" &&
    input.response.pageCoverage.expectedPageCount === input.expectedPageCount &&
    input.response.pageCoverage.missingPages.length === 0 &&
    missingPages.length === 0;

  return {
    complete,
    duplicateKeys,
    invalidConfirmationCodes,
    invalidFindingPages,
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

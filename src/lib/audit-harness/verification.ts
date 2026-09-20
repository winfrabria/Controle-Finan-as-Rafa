import { z } from "zod";

import type {
  HarnessClassification,
  HarnessFinding,
  HarnessInvoice,
} from "./contracts";
import { isSupportedFinding } from "./decision-matrix";
import { hasUncertainSupportCoverage } from "./policy";
import { buildSourceComparisons } from "./source-comparisons";
import { buildDateReviewSources, datedEvidenceClaims, isDatedEvidence } from "./date-review";
import { buildAmountReviewSources, buildAmountReviewPairs, hasAmountReviewEvidence, isMonetaryEvidence, type AmountReviewSource } from "./amount-review";
import type { HarnessVerifierMode } from "./versions";
import { findingSourceObservationSchema, FINDING_SOURCE_KINDS, FINDING_SOURCE_OBSERVATIONS_JSON_SCHEMA, matchingFindingSourceClaims, hasTracedHypothesisPair, hasTracedMonetaryPair, hasUntracedFindingSourceValue, findingClaimScopeSchema, FINDING_CLAIM_SCOPE_JSON_SCHEMA, MAX_FINDING_SOURCE_OBSERVATIONS } from "./finding-source-observations";

// A check may cite every page/source in a large packet. Keep only a generous
// transport safety bound; never treat 20 sources as a document-level limit.
export const MAX_VERIFICATION_EVIDENCE_PER_CHECK = 500;

function sameCalendarClaim(left: string, right: string) {
  const [leftYear, leftMonth, leftDay] = left.split("-");
  const [rightYear, rightMonth, rightDay] = right.split("-");
  if (!leftYear || !rightYear || leftMonth !== rightMonth || leftDay !== rightDay) return false;
  if (leftYear === rightYear) return true;
  // Do not guess a century in isolation. A two-digit printed year can be
  // compared to the explicit four-digit year from its paired source only when
  // the suffix is identical (26 <-> 2026).
  return leftYear.length === 2 && rightYear.length === 4 ? rightYear.endsWith(leftYear)
    : rightYear.length === 2 && leftYear.length === 4 ? leftYear.endsWith(rightYear) : false;
}

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
    evidence: z.array(verificationEvidenceSchema).max(MAX_VERIFICATION_EVIDENCE_PER_CHECK),
    findingCode: z.string().trim().min(1).max(100).nullable(),
    key: z.string().trim().min(1).max(160),
    limitationCode: z.string().trim().min(1).max(100).nullable(),
    lineNumber: z.number().int().positive().nullable(),
    state: z.enum(["VERIFIED", "FINDING", "LIMITATION"]),
    // Optional only for historical responses. Pair coverage requires a decision.
    comparison: z.object({
      outcome: z.enum(["CONSISTENT", "CONFLICT", "UNRELATED", "UNRESOLVED"]),
      basis: z.string().trim().min(1).max(1000),
      leftEvidenceIndex: z.number().int().min(0).max(MAX_VERIFICATION_EVIDENCE_PER_CHECK - 1).nullable(),
      rightEvidenceIndex: z.number().int().min(0).max(MAX_VERIFICATION_EVIDENCE_PER_CHECK - 1).nullable(),
    }).strict().nullable().optional(),
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
    observations: z.array(findingSourceObservationSchema).max(MAX_FINDING_SOURCE_OBSERVATIONS).optional(),
    claimScope: findingClaimScopeSchema,
  })
  .strict();

export const verificationFindingSchema = z
  .object({
    actualValue: z.string().trim().max(1_000).nullable(),
    comparisonMode: z.enum(["REFERENCE", "CONFLICT"]).nullable().optional(),
    referenceBasis: z.string().trim().min(1).max(500).nullable().optional(),
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
        required: ["key", "documentGroup", "lineNumber", "documentRole", "state", "evidence", "findingCode", "limitationCode", "comparison"],
        properties: {
          comparison: {
            type: ["object", "null"], additionalProperties: false,
            required: ["outcome", "basis", "leftEvidenceIndex", "rightEvidenceIndex"],
            properties: {
              outcome: { type: "string", enum: ["CONSISTENT", "CONFLICT", "UNRELATED", "UNRESOLVED"] },
              basis: { type: "string", minLength: 1, maxLength: 1000 },
              leftEvidenceIndex: { type: ["integer", "null"], minimum: 0, maximum: MAX_VERIFICATION_EVIDENCE_PER_CHECK - 1 },
              rightEvidenceIndex: { type: ["integer", "null"], minimum: 0, maximum: MAX_VERIFICATION_EVIDENCE_PER_CHECK - 1 },
            },
          },
          key: { type: "string", minLength: 1, maxLength: 160 },
          documentGroup: { type: ["string", "null"], minLength: 1, maxLength: 160 },
          lineNumber: { type: ["integer", "null"], minimum: 1 },
          documentRole: { type: ["string", "null"], enum: ["LINE_ITEM", "AGGREGATE_PAYMENT", "SUPPORTING_DOCUMENT", "SUMMARY", null] },
          state: { type: "string", enum: ["VERIFIED", "FINDING", "LIMITATION"] },
          evidence: {
            type: "array",
            maxItems: MAX_VERIFICATION_EVIDENCE_PER_CHECK,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["page", "field", "quote", "source"],
              properties: {
                page: { type: "integer", minimum: 1 },
                field: { type: ["string", "null"], minLength: 1, maxLength: 200 },
                quote: { type: "string", minLength: 1, maxLength: 500 },
                source: { type: "string", enum: FINDING_SOURCE_KINDS },
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
          required: ["code", "confirmsInitialFindingCode", "title", "description", "category", "severity", "source", "confidence", "justification", "references", "evidence", "expectedValue", "actualValue", "noteItemLineNumber", "comparisonMode", "referenceBasis"],
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
            required: ["summary", "field", "source", "page", "lineNumber", "observations", "claimScope"],
            properties: {
              summary: { type: "string", minLength: 1, maxLength: 2000 },
              field: { type: "string", minLength: 1, maxLength: 200 },
              source: { type: "string", minLength: 1, maxLength: 500 },
              page: { type: "integer", minimum: 1 },
              lineNumber: { type: ["integer", "null"], minimum: 1 },
              observations: FINDING_SOURCE_OBSERVATIONS_JSON_SCHEMA,
              claimScope: FINDING_CLAIM_SCOPE_JSON_SCHEMA,
            },
          },
          expectedValue: { type: ["string", "null"], maxLength: 1000 },
          actualValue: { type: ["string", "null"], maxLength: 1000 },
          comparisonMode: { type: ["string", "null"], enum: ["REFERENCE", "CONFLICT", null] },
          referenceBasis: { type: ["string", "null"], minLength: 1, maxLength: 500 },
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
  hypothesisReview?: { initialFindingIndex: number; code: string; pages: number[] };
  sourcePair?: { lineNumbers: number[]; pages: number[] };
  fieldReview?: { field: "DATE"; pages: number[] };
  amountReview?: { sources: AmountReviewSource[] };
  amountPair?: { sources: [AmountReviewSource, AmountReviewSource] };
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
  initial: Pick<HarnessFinding, "actualValue" | "expectedValue" | "evidence">,
  verification: Pick<VerificationFinding, "actualValue" | "expectedValue" | "evidence">,
) {
  // The same literal values do not confirm a different allegation (for example,
  // document disagreement versus permission to charge the work). Both legacy
  // responses may omit scope, but an explicit scope cannot be dropped or changed.
  if ((initial.evidence.claimScope ?? null) !== (verification.evidence.claimScope ?? null)) return false;
  // A conflict has no authoritative expected value. Compare its full claim set
  // instead of requiring the verifier to invent a reference just to confirm it.
  if (initial.expectedValue == null || verification.expectedValue == null) {
    if (Array.isArray(initial.evidence.observations) && initial.evidence.observations.length >= 2) {
      return matchingFindingSourceClaims(initial.evidence, verification.evidence);
    }
    const initialSet = conflictClaimSet([initial.expectedValue, initial.actualValue]);
    const verifiedSet = conflictClaimSet([verification.expectedValue, verification.actualValue]);
    return initialSet.size >= 2 && initialSet.size === verifiedSet.size &&
      [...initialSet].every((value) => verifiedSet.has(value));
  }
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

function conflictClaimSet(values: unknown[]): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const claim of conflictClaimSet(value)) result.add(claim);
      continue;
    }
    const comparable = comparableClaimValue(value);
    if (comparable?.startsWith("money:") || comparable?.startsWith("date:")) {
      result.add(comparable);
      continue;
    }
    if (typeof value !== "string") continue;
    const dates = value.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/gu) ?? [];
    const amounts = value.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/gu, "")
      .match(/R\$\s*-?\d[\d.,]*|(?<![\d.,])-?\d+(?:\.\d{3})*,\d{2}(?!\d)|(?<![\d.,])-?\d+\.\d{2}(?!\d)/gu) ?? [];
    for (const token of [...dates, ...amounts]) {
      const claim = comparableClaimValue(token);
      if (claim?.startsWith("money:") || claim?.startsWith("date:")) result.add(claim);
    }
  }
  return result;
}

export function requiresIndependentAiConfirmation(finding: HarnessFinding) {
  if (finding.source !== "AI_DISCOVERY" || finding.severity === "INFO") return false;
  if (finding.comparisonMode === "CONFLICT" ||
    (Array.isArray(finding.evidence.observations) && finding.evidence.observations.length >= 2)) return true;
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
  initialFindings: HarnessFinding[] = [],
): VerificationCheckRequest[] {
  const datesByLine = new Map(buildDateReviewSources(invoice).map(source => [source.lineNumber, source.pages]));
  const amountsByLine = new Map(buildAmountReviewSources(invoice).map(source => [source.lineNumber, source.sources]));
  const amountPairs = buildAmountReviewPairs(invoice);
  const firstAmountPairByLine = new Map<number, typeof amountPairs[number]>();
  for (const pair of amountPairs) if (!firstAmountPairByLine.has(pair.lineNumber)) firstAmountPairByLine.set(pair.lineNumber, pair);
  const itemChecks = invoice.items.map((item) => ({
    documentGroup: item.documentGroup ?? null,
    documentRole: item.documentRole ?? null,
    key: `line:${item.lineNumber}`,
    lineNumber: item.lineNumber,
    ...(datesByLine.has(item.lineNumber) ? { fieldReview: { field: "DATE" as const, pages: datesByLine.get(item.lineNumber)! } } : {}),
    ...(amountsByLine.has(item.lineNumber) ? { amountReview: { sources: amountsByLine.get(item.lineNumber)! } } : {}),
    ...(firstAmountPairByLine.has(item.lineNumber) ? { amountPair: { sources: firstAmountPairByLine.get(item.lineNumber)!.sources } } : {}),
  }));
  const pairChecks: VerificationCheckRequest[] = buildSourceComparisons(invoice).candidates.map(pair => ({
    key: pair.key, documentGroup: null, documentRole: null, lineNumber: null,
    sourcePair: { lineNumbers: pair.lineNumbers, pages: pair.pages },
    ...(pair.basis === "UNIQUE_DESCRIPTION_AND_AMOUNT_ACROSS_LAYERS"
      ? { fieldReview: { field: "DATE" as const, pages: pair.pages } } : {}),
  }));
  // Require date evidence inside the existing row check, rather than doubling
  // the response with a second complete inventory of the same rows.
  // A hypothesis must receive an explicit disposition, not disappear behind
  // PASS checks that merely transcribe each source in isolation. The array
  // index distinguishes separate claims even when discovery repeats a code.
  const hypothesisChecks: VerificationCheckRequest[] = initialFindings.flatMap((finding, initialFindingIndex) => {
    const sources = z.array(findingSourceObservationSchema).min(2).max(MAX_FINDING_SOURCE_OBSERVATIONS).safeParse(finding.evidence.observations);
    if (!requiresIndependentAiConfirmation(finding) || !sources.success) return [];
    return [{ key: `hypothesis:${initialFindingIndex + 1}`, documentGroup: null, documentRole: null,
      lineNumber: finding.noteItemLineNumber,
      hypothesisReview: { initialFindingIndex, code: finding.code, pages: sources.data.map(source => source.page) } }];
  });
  // Reuse the row's existing evidence and response for its first pair. Only
  // additional pairs need a separate check; no pair is silently dropped.
  const amountPairChecks: VerificationCheckRequest[] = amountPairs.filter(pair =>
    firstAmountPairByLine.get(pair.lineNumber) !== pair).map(pair => ({
    key: pair.key, lineNumber: pair.lineNumber, documentGroup: null, documentRole: null,
    amountPair: { sources: pair.sources },
  }));
  const allChecks = [...itemChecks, ...pairChecks, ...hypothesisChecks, ...amountPairChecks];
  const boundedChecks = allChecks.slice(0, 297);
  return [
    { documentGroup: null, documentRole: null, key: "document:coverage", lineNumber: null },
    { documentGroup: null, documentRole: null, key: "document:total", lineNumber: null },
    ...boundedChecks,
    ...(allChecks.length > boundedChecks.length
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
  // Page count comes from the original attachment, not a model's confidence or
  // completeness declaration. Multi-document submissions need an independent
  // check once their size makes omitted supporting sources materially likely.
  const pageCount = Number.isSafeInteger(input.pageCount) && (input.pageCount ?? 0) > 0
    ? input.pageCount! : null;
  const composite = kind === "COMPOSITE" || kind === "REIMBURSEMENT";
  if (composite && pageCount === null) reasons.push("COMPLEX_PAGE_COUNT_UNKNOWN");
  if (composite && pageCount !== null && pageCount >= 5) reasons.push("COMPLEX_MULTI_PAGE_DOCUMENT");
  if (pageCount !== null && pageCount >= 10) reasons.push("LONG_DOCUMENT");
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
  const expectedByKey = new Map(input.expectedChecks.map((check) => [check.key, check]));
  const receivedKeys = input.response.checks.map((check) => check.key);
  const duplicateKeys = receivedKeys.filter((key, index) => receivedKeys.indexOf(key) !== index);
  const unknownKeys = receivedKeys.filter((key) => !expectedKeys.has(key));
  const missingKeys = [...expectedKeys].filter((key) => !receivedKeys.includes(key));
  const expectedPages = input.expectedPageCount
    ? Array.from({ length: input.expectedPageCount }, (_, index) => index + 1)
    : [];
  const checked = new Set(input.response.pageCoverage.checkedPages);
  const missingPages = expectedPages.filter((page) => !checked.has(page));
  const validPage = (page: number) => Number.isSafeInteger(page) && page > 0 &&
    (input.expectedPageCount === null || page <= input.expectedPageCount);
  const duplicatePages = input.response.pageCoverage.checkedPages.filter((page, index, pages) => pages.indexOf(page) !== index);
  const invalidPages = [...input.response.pageCoverage.checkedPages, ...input.response.pageCoverage.missingPages].filter((page) => !validPage(page));
  const mismatchedCheckKeys = input.response.checks.filter((check) => {
    const expected = expectedByKey.get(check.key);
    return expected && (check.lineNumber !== expected.lineNumber ||
      check.documentGroup !== expected.documentGroup || check.documentRole !== expected.documentRole);
  }).map((check) => check.key);
  const evidenceMissingCheckKeys = input.response.checks.filter((check) =>
    check.state !== "LIMITATION" && check.evidence.length === 0).map((check) => check.key);
  const invalidEvidenceCheckKeys = input.response.checks.filter((check) => {
    if (check.evidence.some((evidence) => !validPage(evidence.page) || !evidence.quote.trim() || !evidence.source.trim())) return true;
    const expected = expectedByKey.get(check.key);
    const review = expected?.fieldReview;
    return check.state !== "LIMITATION" && (
      (review?.field === "DATE" && review.pages.some(page =>
        !check.evidence.some(evidence => evidence.page === page && isDatedEvidence(evidence)))) ||
      (expected?.amountReview !== undefined && !hasAmountReviewEvidence(expected.amountReview.sources, check.evidence)) ||
      (expected?.amountPair !== undefined && !hasAmountReviewEvidence(expected.amountPair.sources, check.evidence))
    );
  }).map((check) => check.key);
  const invalidComparisonCheckKeys = input.response.checks.filter(check => {
    const expected = expectedByKey.get(check.key);
    const hypothesis = expected?.hypothesisReview;
    const pair = expected?.sourcePair ?? hypothesis;
    const amountPair = expected?.amountPair;
    const comparison = check.comparison;
    if (!pair && !amountPair) {
      if (comparison == null) return false;
      // Totals may legitimately be reconciled without a preselected item pair.
      if (check.key !== "document:total") return true;
      if (comparison.outcome === "UNRESOLVED") return check.state !== "LIMITATION";
      const left = comparison.leftEvidenceIndex, right = comparison.rightEvidenceIndex;
      if (left === null || right === null || left === right || !check.evidence[left] || !check.evidence[right] ||
        !isMonetaryEvidence(check.evidence[left]) || !isMonetaryEvidence(check.evidence[right])) return true;
      if (comparison.outcome === "CONFLICT") return check.state !== "FINDING" || !input.response.findings.some(finding =>
        finding.code === check.findingCode && hasTracedMonetaryPair(finding.evidence, [check.evidence[left], check.evidence[right]]));
      return check.state !== "VERIFIED";
    }
    if (!comparison) return true;
    if (comparison.outcome === "UNRESOLVED") return check.state !== "LIMITATION";
    const left = comparison.leftEvidenceIndex;
    const right = comparison.rightEvidenceIndex;
    if (left === null || right === null || left === right) return true;
    if (hypothesis) {
      if (hypothesis.pages.some(page => !check.evidence.some(evidence => evidence.page === page))) return true;
      const initial = input.initialFindings?.[hypothesis.initialFindingIndex];
      if (!initial || initial.code !== hypothesis.code) return true;
      if (!hasTracedHypothesisPair(initial.evidence, check.evidence, left, right, comparison.outcome === "CONFLICT")) return true;
      if (comparison.outcome === "CONFLICT" && !input.response.findings.some(finding =>
        finding.code === check.findingCode && explicitlyConfirmedVerificationFindings([initial], [finding]).length > 0)) return true;
    } else if (amountPair) {
      if (!hasAmountReviewEvidence([amountPair.sources[0]], check.evidence[left] ? [check.evidence[left]] : []) ||
        !hasAmountReviewEvidence([amountPair.sources[1]], check.evidence[right] ? [check.evidence[right]] : [])) return true;
      // A CONFLICT disposition cannot point at an unrelated finding. Its own
      // value-bearing source claims must be traced to the selected pair.
      if (comparison.outcome === "CONFLICT" && !input.response.findings.some(finding =>
        finding.code === check.findingCode && hasTracedMonetaryPair(finding.evidence, [check.evidence[left], check.evidence[right]]))) return true;
    } else {
      if (check.evidence[left]?.page !== pair!.pages[0] || check.evidence[right]?.page !== pair!.pages[1]) return true;
      if (expected?.fieldReview?.field === "DATE" &&
        (comparison.outcome === "CONSISTENT" || comparison.outcome === "CONFLICT")) {
        const leftDates = datedEvidenceClaims(check.evidence[left]);
        const rightDates = datedEvidenceClaims(check.evidence[right]);
        if (leftDates.length !== 1 || rightDates.length !== 1 ||
          (comparison.outcome === "CONSISTENT") !== sameCalendarClaim(leftDates[0], rightDates[0])) return true;
      }
    }
    return comparison.outcome === "CONFLICT" ? check.state !== "FINDING" : check.state !== "VERIFIED";
  }).map(check => check.key);
  // A list of page numbers is only a claim. Every page must also appear in a
  // locatable original-document excerpt; row identity cannot be silently changed.
  const evidencedPages = new Set(input.response.checks.flatMap((check) =>
    mismatchedCheckKeys.includes(check.key) || unknownKeys.includes(check.key)
      ? [] : check.evidence.filter((evidence) => validPage(evidence.page) && evidence.quote.trim() && evidence.source.trim()).map((evidence) => evidence.page)));
  const unevidencedPages = expectedPages.filter((page) => !evidencedPages.has(page));
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
        (finding.evidence.page > input.expectedPageCount ||
          (finding.evidence.observations ?? []).some(source => source.page > input.expectedPageCount!)),
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
  const invalidFindingEvidenceCodes = input.response.findings.filter(finding =>
    hasUntracedFindingSourceValue(finding.evidence)).map(finding => finding.code);
  const complete =
    duplicateKeys.length === 0 &&
    unknownKeys.length === 0 &&
    missingKeys.length === 0 &&
    mismatchedCheckKeys.length === 0 &&
    evidenceMissingCheckKeys.length === 0 &&
    invalidEvidenceCheckKeys.length === 0 &&
    invalidComparisonCheckKeys.length === 0 &&
    duplicatePages.length === 0 &&
    invalidPages.length === 0 &&
    unevidencedPages.length === 0 &&
    unlinkedFindingCodes.length === 0 &&
    orphanCheckFindingCodes.length === 0 &&
    !hasLimitationCheck &&
    !hasOverflow &&
    invalidFindingPages.length === 0 &&
    invalidConfirmationCodes.length === 0 &&
    invalidFindingEvidenceCodes.length === 0 &&
    input.response.status !== "LIMITED" &&
    input.response.limitations.length === 0 &&
    input.expectedPageCount !== null &&
    input.response.pageCoverage.status === "COMPLETE" &&
    input.response.pageCoverage.expectedPageCount === input.expectedPageCount &&
    input.response.pageCoverage.missingPages.length === 0 &&
    missingPages.length === 0;

  return {
    complete,
    invalidFindingEvidenceCodes,
    duplicateKeys,
    duplicatePages,
    evidenceMissingCheckKeys,
    invalidEvidenceCheckKeys,
    invalidComparisonCheckKeys,
    invalidPages,
    mismatchedCheckKeys,
    unevidencedPages,
    invalidConfirmationCodes,
    invalidFindingPages,
    missingKeys,
    missingPages,
    orphanCheckFindingCodes,
    unknownKeys,
    unlinkedFindingCodes,
  };
}

const verificationFailureCodeSchema = z.enum([
  "VERIFICATION_TIMEOUT", "VERIFICATION_PROVIDER_ERROR", "VERIFICATION_ENDPOINT_UNAVAILABLE",
  "VERIFICATION_INVALID_RESPONSE", "VERIFICATION_TRACE_INVALID", "VERIFICATION_UNSUPPORTED_FINDING",
  "VERIFICATION_STORED_RESPONSE_INVALID", "VERIFICATION_IN_PROGRESS", "VERIFICATION_CALL_ALREADY_CONSUMED",
  "VERIFICATION_UNSUPPORTED_MIME_TYPE", "VERIFICATION_REFERENCE_CHANGED", "VERIFICATION_HYPOTHESES_CHANGED", "VERIFICATION_RECOVERY_NOT_ALLOWED",
]);

export function normalizeVerificationFailureCode(value: unknown) {
  const parsed = verificationFailureCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : "VERIFICATION_PROVIDER_ERROR" as const;
}

function verificationFailureReason(code: z.infer<typeof verificationFailureCodeSchema>) {
  if (code === "VERIFICATION_RECOVERY_NOT_ALLOWED") {
    return "A recuperação não corresponde ao contexto da tentativa anterior e não foi executada. Isso não indica irregularidade no documento.";
  }
  if (code === "VERIFICATION_HYPOTHESES_CHANGED") {
    return "As hipóteses mudaram desde a verificação independente. As decisões anteriores não foram reutilizadas e nenhuma nova chamada foi feita automaticamente.";
  }
  if (code === "VERIFICATION_REFERENCE_CHANGED") {
    return "As regras da obra mudaram desde a verificação independente. O resultado anterior não foi reutilizado e nenhuma nova chamada foi feita automaticamente.";
  }
  if (code === "VERIFICATION_TIMEOUT") {
    return "O serviço de IA não concluiu a verificação independente no prazo. Isso não comprova falta de informação no documento.";
  }
  if (code === "VERIFICATION_ENDPOINT_UNAVAILABLE") {
    return "Não havia uma rota compatível disponível no serviço de IA para a verificação independente. Isso não comprova falta de informação no documento.";
  }
  if (["VERIFICATION_INVALID_RESPONSE", "VERIFICATION_TRACE_INVALID", "VERIFICATION_UNSUPPORTED_FINDING", "VERIFICATION_STORED_RESPONSE_INVALID"].includes(code)) {
    return "A resposta da verificação independente não apresentou evidência válida suficiente. Isso é uma limitação da análise, não uma irregularidade comprovada no documento.";
  }
  if (code === "VERIFICATION_IN_PROGRESS") return "A verificação independente ainda está em andamento; não há conclusão integral disponível.";
  if (code === "VERIFICATION_CALL_ALREADY_CONSUMED") return "A tentativa anterior de verificação não foi concluída com sucesso e não foi repetida automaticamente.";
  if (code === "VERIFICATION_UNSUPPORTED_MIME_TYPE") return "O formato do arquivo não é compatível com a verificação independente disponível.";
  return "O serviço de IA não concluiu a verificação independente. Isso não comprova falta de informação no documento.";
}

export function resolveAuditAssurance(input: {
  aiCoverage: boolean;
  classification: HarnessClassification;
  mode: HarnessVerifierMode;
  selection: VerificationSelection;
  verificationCoverageComplete?: boolean;
  verificationStatus?: VerificationResponse["status"] | "FAILED" | "NOT_RUN";
  verificationFailureCode?: z.infer<typeof verificationFailureCodeSchema>;
}): { band: AuditAssuranceBand; reason: string } {
  if (input.classification === "READ_FAILED") {
    return { band: "LIMITED", reason: "O arquivo não permitiu uma leitura confiável." };
  }
  if (input.selection.required && input.mode === "off") {
    return { band: "LIMITED", reason: "O anexo possui fatores de risco que ainda não passaram pela verificação independente." };
  }
  if (input.selection.required && input.verificationStatus === "FAILED" && input.verificationFailureCode) {
    return { band: "LIMITED", reason: verificationFailureReason(input.verificationFailureCode) };
  }
  if (
    input.selection.required &&
    input.mode === "shadow" &&
    (input.verificationStatus === "FAILED" || input.verificationStatus === "LIMITED" || !input.verificationCoverageComplete)
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

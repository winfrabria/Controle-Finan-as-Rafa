import { z } from "zod";
import {
  aiDiscoveryResponseSchema,
  harnessClassificationSchema,
} from "../contracts";

/**
 * Contrato versionado dos casos dourados do Harness (PRD WP-C).
 *
 * O contrato descreve SOMENTE entradas sintéticas e expectativas declaradas.
 * Nenhuma regra aqui pode conter nome de fornecedor, número de nota real,
 * nome de arquivo, placa ou valor vindo de caso real (PRD §3).
 */
export const GOLDEN_CASES_CONTRACT_VERSION = "1.0.0" as const;

export const goldenCaseCategorySchema = z.enum([
  "FISCAL_INVOICE_SIMPLE",
  "SERVICE_INVOICE",
  "INVOICE_WITH_PAYMENT_PROOF",
  "FUEL_WITH_REPORT",
  "MEALS_LODGING_SUPPLIES",
  "COMPOSITE_REIMBURSEMENT",
  "PARTIALLY_ILLEGIBLE",
  "DUPLICATE",
  "EXPLICIT_CONTRADICTION",
  "EXTERNAL_CONTEXT",
  "LEGITIMATE_NEAR_DUPLICATE",
  "GROSS_NET_WITHHOLDING",
  "MULTIPAGE_RECONCILIATION",
  "ZERO_VALUE_AND_GLOBAL_DISCOUNT",
  "OCR_PROMPT_INJECTION",
  "MULTIPLE_LEGITIMATE_TAX_IDS",
  "TIMEZONE_DATE_BOUNDARY",
]);

const evidenceObservationSchema = z.object({
  kind: z.enum(["SHEET", "RECEIPT", "SALE", "PAYMENT", "CHARGE", "DISCOUNT", "OTHER"]),
  amountScope: z.enum(["ITEM_TOTAL", "DOCUMENT_TOTAL", "UNIT_VALUE", "COMPONENT", "ADJUSTMENT", "CONTEXT", "UNKNOWN"]).optional(),
  documentGroup: z.string().nullish(),
  label: z.string().nullish(),
  amount: z.string().nullish(),
  date: z.string().nullish(),
  page: z.number().int().nullish(),
  text: z.string().nullish(),
});

export const goldenCaseInvoiceSchema = z.object({
  originalFileSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullish(),
  documentKind: z
    .enum(["FISCAL_INVOICE", "REIMBURSEMENT", "COMPOSITE", "PAYMENT_PROOF", "OTHER"])
    .optional(),
  documentNumber: z.string().nullable(),
  supplierName: z.string().nullable(),
  supplierTaxId: z.string().nullable(),
  issuedAt: z.string().nullable(),
  totalAmount: z.string().nullable(),
  readConfidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  markdown: z.string(),
  itemCoverage: z
    .object({
      status: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
      declaredItemCount: z.number().int().nullable(),
      extractedItemCount: z.number().int(),
      firstLineNumber: z.number().int().nullable(),
      lastLineNumber: z.number().int().nullable(),
      missingLineNumbers: z.array(z.number().int()),
      evidence: z.string().nullable(),
    })
    .optional(),
  supportCoverage: z.object({
    status: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
    referencedDocuments: z.array(z.string()),
    presentDocuments: z.array(z.string()),
    missingDocuments: z.array(z.string()),
    basis: z.enum(["DOCUMENT_REFERENCES", "EXPLICIT_COMPLETENESS_STATEMENT", "NONE"]),
    evidence: z.string().nullable(),
  }).optional(),
  requiredFieldChecks: z
    .array(
      z.object({
        field: z.string(),
        label: z.string(),
        requiredByDocument: z.boolean(),
        requirementBasis: z.enum(["EXPLICIT_DOCUMENT", "VERIFIED_POLICY", "NONE"]).optional(),
        requirementEvidence: z.string().nullish(),
        present: z.boolean(),
        page: z.number().int().nullable(),
        evidence: z.string().nullable(),
      }),
    )
    .optional(),
  documentObservations: z.array(evidenceObservationSchema).optional(),
  items: z.array(
    z.object({
      lineNumber: z.number().int().positive(),
      description: z.string(),
      documentGroup: z.string().nullish(),
      documentRole: z
        .enum(["LINE_ITEM", "AGGREGATE_PAYMENT", "SUPPORTING_DOCUMENT", "SUMMARY"])
        .nullish(),
      countsTowardDocumentTotal: z.boolean().nullish(),
      arithmeticVerified: z.boolean().nullish(),
      parentLineNumber: z.number().int().positive().nullish(),
      breakdownComplete: z.boolean().optional(),
      sourcePage: z.number().int().positive().nullish(),
      sourceKind: z.enum(["FISCAL_LINE", "SHEET", "RECEIPT", "SALE", "PAYMENT", "CHARGE", "OTHER", "UNKNOWN"]).optional(),
      sourceDate: z.string().nullable().optional(),
      sourceText: z.string().nullish(),
      quantity: z.string().nullable(),
      unitPrice: z.string().nullable(),
      totalAmount: z.string().nullable(),
      evidenceObservations: z.array(evidenceObservationSchema).optional(),
    }),
  ),
});

const workRuleSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  configuration: z.unknown(),
});

const duplicateCandidateSchema = z.object({
  noteId: z.string(),
  originalFileSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullish(),
  documentNumber: z.string().nullable(),
  supplierTaxId: z.string().nullable(),
  issuedAt: z.string().nullable(),
  totalAmount: z.string().nullable(),
});

/**
 * Entrada do caso. Em modo offline, `aiDiscovery` é a resposta gravada
 * (replay determinístico). Nenhuma chamada de rede acontece no runner.
 */
export const goldenCaseInputSchema = z
  .object({
    invoice: goldenCaseInvoiceSchema,
    workRules: z.array(workRuleSchema).default([]),
    duplicates: z.array(duplicateCandidateSchema).default([]),
    aiDiscovery: aiDiscoveryResponseSchema.optional(),
    /** Data fixa para avaliação determinística (ex.: FUTURE_ISSUE_DATE). */
    now: z.string().date().default("2026-08-21"),
  })
  .strict();

export const goldenCaseExpectationsSchema = z
  .object({
    acceptableClassifications: z.array(harnessClassificationSchema).min(1),
    requiredFindingCodes: z.array(z.string().min(1)).default([]),
    forbiddenFindingCodes: z.array(z.string().min(1)).default([]),
    requiredContextQuestionCodes: z.array(z.string().min(1)).default([]),
    forbiddenContextQuestionCodes: z.array(z.string().min(1)).default([]),
    /** Areas que o caso precisa realmente exercitar no resultado do Harness. */
    requiredCoverageAreas: z.array(z.string().trim().min(1)).default([]),
    /** Fragmentos do OCR que jamais podem reaparecer no payload publico. */
    forbiddenOutputFragments: z.array(z.string().trim().min(1)).default([]),
    maxSemanticDuplicates: z.number().int().min(0).default(0),
  })
  .strict();

/**
 * Campos opcionais de custo/latência para execuções online opt-in.
 * No modo offline eles são reportados como não avaliados; nenhuma chamada
 * de provedor é feita.
 */
export const goldenCaseOnlineBudgetSchema = z
  .object({
    maxCostUsd: z.number().min(0).optional(),
    maxLatencyMsP50: z.number().int().min(0).optional(),
    maxLatencyMsP95: z.number().int().min(0).optional(),
    maxProviderCalls: z.number().int().min(0).optional(),
  })
  .strict();

export const goldenCaseSchema = z
  .object({
    contractVersion: z.literal(GOLDEN_CASES_CONTRACT_VERSION),
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .min(1)
      .max(80),
    title: z.string().min(1).max(200),
    category: goldenCaseCategorySchema,
    input: goldenCaseInputSchema,
    expectations: goldenCaseExpectationsSchema,
    onlineBudget: goldenCaseOnlineBudgetSchema.optional(),
  })
  .strict();

export const goldenCasesFileSchema = z
  .object({
    contractVersion: z.literal(GOLDEN_CASES_CONTRACT_VERSION),
    cases: z.array(goldenCaseSchema).min(1),
  })
  .superRefine((file, context) => {
    const ids = file.cases.map((goldenCase) => goldenCase.id);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicated.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Duplicate golden case ids: ${[...new Set(duplicated)].join(", ")}.`,
        path: ["cases"],
      });
    }
  });

export type GoldenCaseInvoice = z.infer<typeof goldenCaseInvoiceSchema>;
export type GoldenCaseInput = z.infer<typeof goldenCaseInputSchema>;
export type GoldenCaseExpectations = z.infer<typeof goldenCaseExpectationsSchema>;
export type GoldenCaseOnlineBudget = z.infer<typeof goldenCaseOnlineBudgetSchema>;
export type GoldenCase = z.infer<typeof goldenCaseSchema>;
export type GoldenCasesFile = z.infer<typeof goldenCasesFileSchema>;

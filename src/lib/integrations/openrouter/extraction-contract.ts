import { z } from "zod";
import { isValidIsoCalendarDate } from "@/lib/calendar-date";

import { INVOICE_EXTRACTION_PROMPT } from "@/lib/audit-harness/prompts";

const nullableText = z.string().trim().min(1).nullable().default(null);

function normalizeNullableText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value;
}

function normalizeDecimal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") return value;

  const compact = value.replace(/\s|R\$/gi, "");
  if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,4}$/.test(compact)) {
    return compact.replace(/\./g, "").replace(",", ".");
  }
  if (/^-?\d{1,12},\d{1,4}$/.test(compact)) {
    return compact.replace(",", ".");
  }
  return compact;
}

const decimalText = z.preprocess(
  normalizeDecimal,
  z
    .string()
    .regex(/^-?\d{1,12}(?:\.\d{1,4})?$/, "Invalid decimal value")
    .nullable()
    .default(null),
);

const isoDate = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    const brazilianDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    return brazilianDate
      ? `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}`
      : /^\d{4}-\d{2}-\d{2}T/.test(trimmed)
        ? trimmed.slice(0, 10)
        : trimmed;
  },
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidIsoCalendarDate, "Invalid calendar date")
    .nullable()
    .default(null),
);

export const documentKindSchema = z.enum([
  "FISCAL_INVOICE",
  "REIMBURSEMENT",
  "COMPOSITE",
  "PAYMENT_PROOF",
  "OTHER",
]);

export const invoiceItemCoverageSchema = z
  .object({
    status: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
    declaredItemCount: z.number().int().nonnegative().nullable().default(null),
    extractedItemCount: z.number().int().nonnegative(),
    firstLineNumber: z.number().int().positive().nullable().default(null),
    lastLineNumber: z.number().int().positive().nullable().default(null),
    missingLineNumbers: z.array(z.number().int().positive()).max(500).default([]),
    evidence: nullableText,
  })
  .strict();

export const invoiceSupportCoverageSchema = z
  .object({
    status: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
    referencedDocuments: z.array(z.string().trim().min(1)).max(200).default([]),
    presentDocuments: z.array(z.string().trim().min(1)).max(200).default([]),
    missingDocuments: z.array(z.string().trim().min(1)).max(200).default([]),
    basis: z.enum([
      "DOCUMENT_REFERENCES",
      "EXPLICIT_COMPLETENESS_STATEMENT",
      "NONE",
    ]),
    evidence: nullableText,
  })
  .strict();

export const invoiceBoundingBoxSchema = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.enum(["NORMALIZED", "PIXEL"]),
  })
  .strict();

const UNKNOWN_ITEM_COVERAGE = {
  status: "UNKNOWN" as const,
  declaredItemCount: null,
  extractedItemCount: 0,
  firstLineNumber: null,
  lastLineNumber: null,
  missingLineNumbers: [] as number[],
  evidence: null,
};

const UNKNOWN_SUPPORT_COVERAGE = {
  status: "UNKNOWN" as const,
  referencedDocuments: [] as string[],
  presentDocuments: [] as string[],
  missingDocuments: [] as string[],
  basis: "NONE" as const,
  evidence: null,
};

export const invoiceEvidenceObservationSchema = z
  .object({
    kind: z.enum(["SHEET", "RECEIPT", "SALE", "PAYMENT", "DISCOUNT", "OTHER"]),
    documentGroup: nullableText,
    label: nullableText,
    amount: decimalText,
    date: isoDate,
    page: z.number().int().positive().nullable().default(null),
    text: nullableText,
    boundingBox: invoiceBoundingBoxSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (observation) =>
      observation.amount !== null ||
      observation.date !== null ||
      observation.text !== null,
    { message: "Evidence observations need an amount, date or text." },
  );

export const invoiceRequiredFieldCheckSchema = z
  .object({
    field: z.string().trim().min(1),
    label: z.string().trim().min(1),
    requiredByDocument: z.boolean(),
    requirementBasis: z
      .enum(["EXPLICIT_DOCUMENT", "VERIFIED_POLICY", "NONE"])
      .optional(),
    requirementEvidence: nullableText.optional(),
    present: z.boolean(),
    page: z.number().int().positive().nullable().default(null),
    evidence: nullableText,
    boundingBox: invoiceBoundingBoxSchema.nullable().optional(),
  })
  .strict();

const documentRoleSchema = z.enum([
  "LINE_ITEM",
  "AGGREGATE_PAYMENT",
  "SUPPORTING_DOCUMENT",
  "SUMMARY",
]);

function normalizeDocumentRole(value: unknown) {
  if (typeof value !== "string") return "LINE_ITEM" as const;
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, z.infer<typeof documentRoleSchema>> = {
    AGGREGATE: "AGGREGATE_PAYMENT",
    AGGREGATE_PAYMENT: "AGGREGATE_PAYMENT",
    BOLETO: "AGGREGATE_PAYMENT",
    CHARGE: "AGGREGATE_PAYMENT",
    FISCAL_DOCUMENT: "SUPPORTING_DOCUMENT",
    INVOICE: "SUPPORTING_DOCUMENT",
    LINE: "LINE_ITEM",
    LINE_ITEM: "LINE_ITEM",
    SUMMARY: "SUMMARY",
    SUPPORT: "SUPPORTING_DOCUMENT",
    SUPPORTING_DOCUMENT: "SUPPORTING_DOCUMENT",
  };
  return aliases[normalized] ?? "LINE_ITEM";
}

export const invoiceExtractionItemSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    code: nullableText,
    description: z.string().trim().min(1),
    documentGroup: nullableText,
    documentRole: documentRoleSchema.default("LINE_ITEM"),
    countsTowardDocumentTotal: z.boolean().optional(),
    arithmeticVerified: z.boolean().optional(),
    sourcePage: z.number().int().positive().nullable().default(null),
    sourceText: nullableText,
    sourceBoundingBox: invoiceBoundingBoxSchema.nullable().optional(),
    quantity: decimalText,
    unit: nullableText,
    unitPrice: decimalText,
    totalAmount: decimalText,
    evidenceObservations: z
      .array(invoiceEvidenceObservationSchema)
      .max(12)
      .default([]),
  })
  .strict();

export const invoicePageCoverageSchema = z.object({
  page: z.number().int().positive(),
  complete: z.boolean(),
  sources: z.array(z.object({
    kind: z.enum(["SHEET", "RECEIPT", "SALE", "PAYMENT", "DISCOUNT", "OTHER"]),
    count: z.number().int().positive().max(500),
  }).strict()).max(6),
  fieldsReviewed: z.boolean(),
  requirementScope: z.enum(["ALL_FIELDS", "SPECIFIC_FIELDS", "NONE", "UNKNOWN"]),
  requirementEvidence: nullableText,
}).strict();

export const invoiceExtractionSchema = z
  .object({
    documentKind: documentKindSchema.default("OTHER"),
    documentNumber: nullableText,
    supplierName: nullableText,
    supplierTaxId: nullableText,
    issuedAt: isoDate,
    totalAmount: decimalText,
    currency: z.string().trim().length(3).default("BRL"),
    items: z.array(invoiceExtractionItemSchema).max(500),
    itemCoverage: invoiceItemCoverageSchema.default(UNKNOWN_ITEM_COVERAGE),
    supportCoverage: invoiceSupportCoverageSchema.optional(),
    // Optional for historical rows; the provider contract requests it on new reads.
    pageCoverage: z.array(invoicePageCoverageSchema).max(500).optional(),
    requiredFieldChecks: z
      .array(invoiceRequiredFieldCheckSchema)
      .max(50)
      .default([]),
    markdown: z.string().trim().min(1).max(50_000),
    readConfidence: z.number().min(0).max(1),
    warnings: z.array(z.string().trim().min(1)).max(50).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const lineNumbers = new Set<number>();

    value.items.forEach((item, index) => {
      if (lineNumbers.has(item.lineNumber)) {
        context.addIssue({
          code: "custom",
          message: "Item line numbers must be unique.",
          path: ["items", index, "lineNumber"],
        });
      }

      lineNumbers.add(item.lineNumber);
    });
  });

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

const OCR_FALLBACK_WARNING =
  "A estruturação automática foi parcial; a auditoria deve usar o texto OCR integral.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedBoundingBox(value: unknown) {
  if (!isRecord(value)) return null;
  const parsed = invoiceBoundingBoxSchema.safeParse({
    x: value.x,
    y: value.y,
    width: value.width ?? value.w,
    height: value.height ?? value.h,
    unit:
      typeof value.unit === "string"
        ? value.unit.trim().toUpperCase()
        : "NORMALIZED",
  });
  return parsed.success ? parsed.data : null;
}

function normalizedConfidence(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return 0;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return Math.min(Math.max(numeric, 0), 1);
}

function normalizedCurrency(value: unknown) {
  if (typeof value !== "string") return "BRL";
  const normalized = value.trim().toUpperCase();
  return normalized === "R$" || normalized.length !== 3 ? "BRL" : normalized;
}

function normalizedWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((warning): warning is string => typeof warning === "string")
    .map((warning) => warning.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function normalizedItemCoverage(
  value: unknown,
  items: Array<{ countsTowardDocumentTotal?: unknown }>,
) {
  if (!isRecord(value)) {
    return { ...UNKNOWN_ITEM_COVERAGE, extractedItemCount: items.length };
  }

  const rawStatus =
    typeof value.status === "string" ? value.status.trim().toUpperCase() : "UNKNOWN";
  let status: "COMPLETE" | "INCOMPLETE" | "UNKNOWN" =
    rawStatus === "COMPLETE" || rawStatus === "INCOMPLETE" ? rawStatus : "UNKNOWN";
  const numberOrNull = (candidate: unknown) =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : null;
  const positiveOrNull = (candidate: unknown) => {
    const number = numberOrNull(candidate);
    return number !== null && number > 0 ? number : null;
  };
  const missingLineNumbers = Array.isArray(value.missingLineNumbers)
    ? value.missingLineNumbers
        .filter(
          (candidate): candidate is number =>
            typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0,
        )
        .slice(0, 500)
    : [];
  const derivedTotalLayerCount = items.filter(
    (item) => item.countsTowardDocumentTotal === true,
  ).length;
  const extractedItemCount =
    derivedTotalLayerCount > 0
      ? derivedTotalLayerCount
      : items.length;
  const declaredItemCount = numberOrNull(
    value.declaredItemCount ?? value.declared_item_count,
  );

  if (
    missingLineNumbers.length > 0 ||
    (declaredItemCount !== null && extractedItemCount < declaredItemCount)
  ) {
    status = "INCOMPLETE";
  }

  return {
    status,
    declaredItemCount,
    extractedItemCount,
    firstLineNumber: positiveOrNull(
      value.firstLineNumber ?? value.first_line_number,
    ),
    lastLineNumber: positiveOrNull(
      value.lastLineNumber ?? value.last_line_number,
    ),
    missingLineNumbers,
    evidence: normalizeNullableText(value.evidence ?? value.summary),
  };
}

function normalizedSupportCoverage(value: unknown) {
  if (!isRecord(value)) return UNKNOWN_SUPPORT_COVERAGE;

  const normalizeDocuments = (candidate: unknown) =>
    Array.isArray(candidate)
      ? [...new Set(candidate.flatMap((entry) => {
          const normalized = normalizeNullableText(entry);
          return typeof normalized === "string" ? [normalized] : [];
        }))].slice(0, 200)
      : [];

  const referencedDocuments = normalizeDocuments(
    value.referencedDocuments ?? value.referenced_documents,
  );
  const presentDocuments = normalizeDocuments(
    value.presentDocuments ?? value.present_documents,
  );
  const missingDocuments = normalizeDocuments(
    value.missingDocuments ?? value.missing_documents,
  );
  const rawBasis =
    typeof value.basis === "string" ? value.basis.trim().toUpperCase() : "NONE";
  const basis = [
    "DOCUMENT_REFERENCES",
    "EXPLICIT_COMPLETENESS_STATEMENT",
    "NONE",
  ].includes(rawBasis)
    ? rawBasis
    : "NONE";
  const rawStatus =
    typeof value.status === "string" ? value.status.trim().toUpperCase() : "UNKNOWN";
  const status =
    missingDocuments.length > 0
      ? "PARTIAL"
      : rawStatus === "COMPLETE" && basis !== "NONE"
        ? "COMPLETE"
        : "UNKNOWN";

  const parsed = invoiceSupportCoverageSchema.safeParse({
    status,
    referencedDocuments,
    presentDocuments,
    missingDocuments,
    basis,
    evidence: normalizeNullableText(value.evidence),
  });
  return parsed.success ? parsed.data : UNKNOWN_SUPPORT_COVERAGE;
}

function normalizedDocumentKind(value: unknown, searchableText: string) {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    const aliases: Record<string, z.infer<typeof documentKindSchema>> = {
      COMPOSITE: "COMPOSITE",
      COMPOSTO: "COMPOSITE",
      FISCAL_INVOICE: "FISCAL_INVOICE",
      INVOICE: "FISCAL_INVOICE",
      NOTA_FISCAL: "FISCAL_INVOICE",
      OTHER: "OTHER",
      OUTRO: "OTHER",
      PAYMENT_PROOF: "PAYMENT_PROOF",
      COMPROVANTE_PAGAMENTO: "PAYMENT_PROOF",
      REEMBOLSO: "REIMBURSEMENT",
      REIMBURSEMENT: "REIMBURSEMENT",
    };
    if (aliases[normalized]) return aliases[normalized];
  }

  if (/reembolso|prestação de contas|expense report/i.test(searchableText)) {
    return "REIMBURSEMENT" as const;
  }
  if (/múltiplos? comprovantes|vários comprovantes|documento composto/i.test(searchableText)) {
    return "COMPOSITE" as const;
  }
  return "OTHER" as const;
}

function normalizedEvidenceObservations(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 12).flatMap((rawObservation) => {
    if (!isRecord(rawObservation)) return [];
    const rawKind =
      typeof rawObservation.kind === "string"
        ? rawObservation.kind.trim().toUpperCase()
        : "OTHER";
    const kindAliases: Record<
      string,
      z.infer<typeof invoiceEvidenceObservationSchema>["kind"]
    > = {
      CARD: "PAYMENT",
      CARTAO: "PAYMENT",
      COMPROVANTE: "RECEIPT",
      CUPOM: "RECEIPT",
      DESCONTO: "DISCOUNT",
      DISCOUNT: "DISCOUNT",
      FICHA: "SHEET",
      OTHER: "OTHER",
      PAGAMENTO: "PAYMENT",
      PAYMENT: "PAYMENT",
      PIX: "PAYMENT",
      RECEIPT: "RECEIPT",
      RECIBO: "RECEIPT",
      SALE: "SALE",
      SHEET: "SHEET",
      VENDA: "SALE",
    };

    const observation = {
      kind: kindAliases[rawKind] ?? "OTHER",
      documentGroup: normalizeNullableText(
        rawObservation.documentGroup ??
          rawObservation.document_group ??
          rawObservation.groupKey ??
          rawObservation.group_key,
      ),
      label: normalizeNullableText(rawObservation.label ?? rawObservation.source),
      amount:
        rawObservation.amount ??
        rawObservation.value ??
        rawObservation.totalAmount ??
        null,
      date: rawObservation.date ?? rawObservation.issuedAt ?? null,
      page:
        typeof rawObservation.page === "number" &&
        Number.isSafeInteger(rawObservation.page) &&
        rawObservation.page > 0
          ? rawObservation.page
          : null,
      text: normalizeNullableText(
        rawObservation.text ?? rawObservation.summary ?? rawObservation.description,
      ),
      boundingBox: normalizedBoundingBox(
        rawObservation.boundingBox ??
          rawObservation.bounding_box ??
          rawObservation.coordinates,
      ),
    };

    const parsed = invoiceEvidenceObservationSchema.safeParse(observation);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizedRequiredFieldChecks(value: unknown) {
  if (!Array.isArray(value)) return [];

  const explicitRequirementPattern =
    /(?:\*\s*$|\bobrigat[oó]ri[oa]s?\b|\bpreenchimento\s+obrigat[oó]rio\b|\brequired\s+field\b|\bmandatory\b)/i;
  const explicitDocumentLabelPattern = /\*\s*$/;

  return value.slice(0, 50).flatMap((rawCheck) => {
    if (!isRecord(rawCheck)) return [];
    const requiredByDocument =
      rawCheck.requiredByDocument ??
      rawCheck.required_by_document ??
      rawCheck.required;
    const rawRequirementBasis =
      typeof rawCheck.requirementBasis === "string"
        ? rawCheck.requirementBasis
        : typeof rawCheck.requirement_basis === "string"
          ? rawCheck.requirement_basis
          : undefined;
    const present = rawCheck.present ?? rawCheck.filled ?? rawCheck.preenchido;
    if (
      typeof requiredByDocument !== "boolean" ||
      typeof present !== "boolean"
    ) {
      return [];
    }

    const field = normalizeNullableText(
      rawCheck.field ?? rawCheck.code ?? rawCheck.name,
    );
    const label = normalizeNullableText(
      rawCheck.label ?? rawCheck.fieldLabel ?? rawCheck.field_label ?? field,
    );
    if (typeof field !== "string" || typeof label !== "string") return [];

    const evidence = normalizeNullableText(
      rawCheck.evidence ?? rawCheck.text ?? rawCheck.excerpt,
    );
    const suppliedRequirementEvidence = normalizeNullableText(
      rawCheck.requirementEvidence ??
        rawCheck.requirement_evidence ??
        rawCheck.requiredBecause,
    );
    const labelWithoutMarker = label.replace(/\s*\*\s*$/, "").trim();
    const hasArithmeticExpression = /\d\s*(?:\*|×|x|\/|\+|-)\s*\d/i.test(
      labelWithoutMarker,
    );
    const hasMeaningfulRequiredLabel =
      labelWithoutMarker.length >= 2 &&
      /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(labelWithoutMarker) &&
      !/^[\d\s()+\-×x*/.,=]+$/i.test(labelWithoutMarker) &&
      !labelWithoutMarker.includes("*") &&
      !hasArithmeticExpression;
    const labelExplicitlyMarksRequirement =
      explicitDocumentLabelPattern.test(label) &&
      hasMeaningfulRequiredLabel;
    const normalizedRequirementBasis = rawRequirementBasis
      ?.trim()
      .toUpperCase();
    const inferredExplicitRequirement =
      requiredByDocument &&
      normalizedRequirementBasis !== "VERIFIED_POLICY" &&
      (labelExplicitlyMarksRequirement ||
        explicitRequirementPattern.test(
          `${suppliedRequirementEvidence ?? ""} ${evidence ?? ""}`,
        ));
    const requirementBasis =
      normalizedRequirementBasis === "VERIFIED_POLICY"
        ? "VERIFIED_POLICY"
        : inferredExplicitRequirement
          ? "EXPLICIT_DOCUMENT"
          : normalizedRequirementBasis ?? "NONE";
    const requirementEvidence =
      suppliedRequirementEvidence ??
      (requirementBasis === "EXPLICIT_DOCUMENT"
        ? labelExplicitlyMarksRequirement
          ? label
          : evidence
        : null);

    const parsed = invoiceRequiredFieldCheckSchema.safeParse({
      field,
      label,
      requiredByDocument,
      requirementBasis,
      requirementEvidence,
      present,
      page:
        typeof rawCheck.page === "number" &&
        Number.isSafeInteger(rawCheck.page) &&
        rawCheck.page > 0
          ? rawCheck.page
          : null,
      evidence,
      boundingBox: normalizedBoundingBox(
        rawCheck.boundingBox ?? rawCheck.bounding_box ?? rawCheck.coordinates,
      ),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

function unwrapExtractionPayload(value: unknown) {
  if (!isRecord(value)) return value;
  for (const key of ["extraction", "invoice", "data", "result"]) {
    const nested = value[key];
    if (isRecord(nested) && ("items" in nested || "markdown" in nested)) {
      return nested;
    }
  }
  return value;
}

export const INVALID_DOCUMENT_DATE_WARNING =
  "Uma data extraída não existe no calendário e precisa ser conferida no documento original.";

/** Preserve readable fields and the original excerpt, never invent a date. */
function recoverInvalidDocumentDates(value: unknown): unknown {
  if (!isRecord(value)) return value;
  let invalidDate = false;
  const repairDateFields = (record: Record<string, unknown>, keys: string[]) => {
    const repaired = { ...record };
    for (const key of keys) {
      const raw = record[key];
      if (raw === undefined || raw === null || raw === "") continue;
      if (!isoDate.safeParse(raw).success) {
        repaired[key] = null;
        invalidDate = true;
      }
    }
    return repaired;
  };
  const repaired = repairDateFields(value, ["issuedAt", "issued_at"]);
  if (Array.isArray(value.items)) {
    repaired.items = value.items.map((item) => {
      if (!isRecord(item)) return item;
      const repairedItem = { ...item };
      for (const key of ["evidenceObservations", "evidence_observations", "evidence"]) {
        const observations = item[key];
        if (Array.isArray(observations)) {
          repairedItem[key] = observations.map((observation) =>
            isRecord(observation)
              ? repairDateFields(observation, ["date", "issuedAt"])
              : observation,
          );
        }
      }
      return repairedItem;
    });
  }
  if (invalidDate) {
    repaired.warnings = [
      INVALID_DOCUMENT_DATE_WARNING,
      ...normalizedWarnings(value.warnings).filter(
        (warning) => warning !== INVALID_DOCUMENT_DATE_WARNING,
      ),
    ].slice(0, 50);
  }
  return repaired;
}

/**
 * Normaliza apenas desvios estruturais seguros e comuns de modelos. Não cria
 * valores fiscais: campos ausentes continuam null, itens sem descrição são
 * descartados e a ordem observada vira a numeração canônica persistida.
 */
export function normalizeInvoiceExtractionPayload(value: unknown): unknown {
  const unwrapped = recoverInvalidDocumentDates(unwrapExtractionPayload(value));
  if (!isRecord(unwrapped)) return unwrapped;
  const payload = unwrapped;

  const warnings = normalizedWarnings(payload.warnings);
  const suppliedMarkdown =
    typeof payload.markdown === "string" ? payload.markdown.trim() : "";
  const rawItems: unknown[] = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .slice(0, 500)
    .flatMap((rawItem, index) => {
      if (!isRecord(rawItem)) return [];
      const description =
        typeof rawItem.description === "string"
          ? rawItem.description.trim()
          : "";
      if (!description) return [];

      return [
        {
          lineNumber: index + 1,
          code: normalizeNullableText(rawItem.code),
          description,
          documentGroup: normalizeNullableText(
            rawItem.documentGroup ??
              rawItem.document_group ??
              rawItem.groupKey ??
              rawItem.group_key,
          ),
          documentRole: normalizeDocumentRole(
            rawItem.documentRole ?? rawItem.document_role ?? rawItem.role,
          ),
          ...(typeof rawItem.countsTowardDocumentTotal === "boolean"
            ? {
                countsTowardDocumentTotal:
                  rawItem.countsTowardDocumentTotal,
              }
            : {}),
          ...(typeof rawItem.arithmeticVerified === "boolean"
            ? { arithmeticVerified: rawItem.arithmeticVerified }
            : {}),
          sourcePage:
            typeof rawItem.sourcePage === "number"
              ? rawItem.sourcePage
              : rawItem.source_page,
          sourceText: normalizeNullableText(
            rawItem.sourceText ?? rawItem.source_text,
          ),
          sourceBoundingBox: normalizedBoundingBox(
            rawItem.sourceBoundingBox ??
              rawItem.source_bounding_box ??
              rawItem.coordinates,
          ),
          quantity: rawItem.quantity ?? rawItem.qty,
          unit: normalizeNullableText(rawItem.unit),
          unitPrice: rawItem.unitPrice ?? rawItem.unit_price,
          totalAmount: rawItem.totalAmount ?? rawItem.total_amount ?? rawItem.total,
          evidenceObservations: normalizedEvidenceObservations(
            rawItem.evidenceObservations ??
              rawItem.evidence_observations ??
              rawItem.evidence,
          ),
        },
      ];
    });
  const generatedMarkdown = items
    .map((item) => {
      const amount =
        item.totalAmount === null || item.totalAmount === undefined
          ? ""
          : ` - ${String(item.totalAmount)}`;
      return `Item ${item.lineNumber}: ${item.description}${amount}`;
    })
    .join("\n");

  if (items.length === 0 && !warnings.length) {
    warnings.push("Nenhum item legível foi extraído do documento.");
  }

  return {
    documentKind: normalizedDocumentKind(
      payload.documentKind ?? payload.document_kind ?? payload.type,
      `${suppliedMarkdown}\n${warnings.join("\n")}`,
    ),
    documentNumber: normalizeNullableText(
      payload.documentNumber ?? payload.document_number,
    ),
    supplierName: normalizeNullableText(
      payload.supplierName ?? payload.supplier_name,
    ),
    supplierTaxId: normalizeNullableText(
      payload.supplierTaxId ?? payload.supplier_tax_id,
    ),
    issuedAt: payload.issuedAt ?? payload.issued_at,
    totalAmount: payload.totalAmount ?? payload.total_amount,
    currency: normalizedCurrency(payload.currency),
    items,
    itemCoverage: normalizedItemCoverage(
      payload.itemCoverage ?? payload.item_coverage,
      items,
    ),
    supportCoverage: normalizedSupportCoverage(
      payload.supportCoverage ?? payload.support_coverage,
    ),
    pageCoverage: z.array(invoicePageCoverageSchema).max(500).safeParse(payload.pageCoverage).success
      ? payload.pageCoverage : undefined,
    requiredFieldChecks: normalizedRequiredFieldChecks(
      payload.requiredFieldChecks ??
        payload.required_field_checks ??
        payload.mandatoryFields ??
        payload.mandatory_fields,
    ),
    markdown: (
      suppliedMarkdown ||
      generatedMarkdown ||
      "Nenhum conteúdo textual confiável foi extraído."
    ).slice(0, 12_000),
    readConfidence: normalizedConfidence(
      payload.readConfidence ?? payload.read_confidence,
    ),
    warnings,
  };
}

export function parseInvoiceExtractionPayload(value: unknown) {
  const recovered = recoverInvalidDocumentDates(unwrapExtractionPayload(value));
  const direct = invoiceExtractionSchema.safeParse(recovered);
  if (direct.success) {
    return invoiceExtractionSchema.safeParse({
      ...direct.data,
      itemCoverage: normalizedItemCoverage(
        direct.data.itemCoverage,
        direct.data.items,
      ),
      supportCoverage: normalizedSupportCoverage(direct.data.supportCoverage),
      requiredFieldChecks: normalizedRequiredFieldChecks(
        direct.data.requiredFieldChecks,
      ),
    });
  }
  return invoiceExtractionSchema.safeParse(
    normalizeInvoiceExtractionPayload(recovered),
  );
}

/**
 * Preserva uma leitura OCR utilizável quando o provedor conseguiu ler o PDF,
 * mas não conseguiu obedecer ao JSON Schema. Nenhum dado fiscal é inferido:
 * a auditoria recebe o texto integral e decide com base nas evidências nele.
 */
export function createOcrFallbackExtraction(
  ocrText: string,
): InvoiceExtraction | null {
  const markdown = ocrText.replace(/\u0000/g, "").trim().slice(0, 12_000);
  if (markdown.length < 120) return null;

  const hasFinancialSignal =
    /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b/.test(markdown);

  return invoiceExtractionSchema.parse({
    currency: "BRL",
    documentKind: "OTHER",
    documentNumber: null,
    issuedAt: null,
    items: [],
    itemCoverage: UNKNOWN_ITEM_COVERAGE,
    supportCoverage: UNKNOWN_SUPPORT_COVERAGE,
    markdown,
    readConfidence: hasFinancialSignal ? 0.65 : 0.6,
    supplierName: null,
    supplierTaxId: null,
    totalAmount: null,
    warnings: [OCR_FALLBACK_WARNING],
  });
}

export function isOcrFallbackExtraction(invoice: { warnings: string[] }) {
  return invoice.warnings.includes(OCR_FALLBACK_WARNING);
}

const BOUNDING_BOX_JSON_SCHEMA = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["x", "y", "width", "height", "unit"],
  properties: {
    x: { type: "number", minimum: 0 },
    y: { type: "number", minimum: 0 },
    width: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 },
    unit: { type: "string", enum: ["NORMALIZED", "PIXEL"] },
  },
} as const;

export const INVOICE_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "documentKind",
    "documentNumber",
    "supplierName",
    "supplierTaxId",
    "issuedAt",
    "totalAmount",
    "currency",
    "items",
    "itemCoverage",
    "supportCoverage",
    "pageCoverage",
    "requiredFieldChecks",
    "markdown",
    "readConfidence",
    "warnings",
  ],
  properties: {
    documentKind: {
      type: "string",
      enum: [
        "FISCAL_INVOICE",
        "REIMBURSEMENT",
        "COMPOSITE",
        "PAYMENT_PROOF",
        "OTHER",
      ],
    },
    documentNumber: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    supplierTaxId: { type: ["string", "null"] },
    issuedAt: {
      type: ["string", "null"],
      description: "Invoice issue date formatted as YYYY-MM-DD.",
    },
    totalAmount: {
      type: ["string", "null"],
      description: "Decimal string without currency symbols.",
    },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    pageCoverage: {
      type: "array", maxItems: 500,
      items: {
        type: "object", additionalProperties: false,
        required: ["page", "complete", "sources", "fieldsReviewed", "requirementScope", "requirementEvidence"],
        properties: {
          page: { type: "integer", minimum: 1 },
          complete: { type: "boolean" },
          sources: {
            type: "array", maxItems: 6,
            items: {
              type: "object", additionalProperties: false, required: ["kind", "count"],
              properties: {
                kind: { type: "string", enum: ["SHEET", "RECEIPT", "SALE", "PAYMENT", "DISCOUNT", "OTHER"] },
                count: { type: "integer", minimum: 1, maximum: 500 },
              },
            },
          },
          fieldsReviewed: { type: "boolean" },
          requirementScope: { type: "string", enum: ["ALL_FIELDS", "SPECIFIC_FIELDS", "NONE", "UNKNOWN"] },
          requirementEvidence: { type: ["string", "null"] },
        },
      },
    },
    items: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "lineNumber",
          "code",
          "description",
          "documentGroup",
          "documentRole",
          "countsTowardDocumentTotal",
          "arithmeticVerified",
          "sourcePage",
          "sourceText",
          "sourceBoundingBox",
          "quantity",
          "unit",
          "unitPrice",
          "totalAmount",
          "evidenceObservations",
        ],
        properties: {
          lineNumber: { type: "integer", minimum: 1 },
          code: { type: ["string", "null"] },
          description: { type: "string", minLength: 1 },
          documentGroup: {
            type: ["string", "null"],
            description:
              "Stable identifier shared by an aggregate charge and the documents or line items that support it.",
          },
          documentRole: {
            type: "string",
            enum: [
              "LINE_ITEM",
              "AGGREGATE_PAYMENT",
              "SUPPORTING_DOCUMENT",
              "SUMMARY",
            ],
          },
          countsTowardDocumentTotal: {
            type: "boolean",
            description:
              "True only when this item belongs to the single non-overlapping layer that composes the document total.",
          },
          arithmeticVerified: {
            type: "boolean",
            description:
              "True only after quantity, unit price and printed line total were visually confirmed in the same source row.",
          },
          sourcePage: {
            type: ["integer", "null"],
            minimum: 1,
            description: "PDF page containing the source row for this item.",
          },
          sourceText: {
            type: ["string", "null"],
            description: "Shortest useful visible excerpt identifying the source row.",
          },
          sourceBoundingBox: BOUNDING_BOX_JSON_SCHEMA,
          quantity: { type: ["string", "null"] },
          unit: { type: ["string", "null"] },
          unitPrice: { type: ["string", "null"] },
          totalAmount: { type: ["string", "null"] },
          evidenceObservations: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "kind",
                "documentGroup",
                "label",
                "amount",
                "date",
                "page",
                "text",
                "boundingBox",
              ],
              properties: {
                kind: {
                  type: "string",
                  enum: ["SHEET", "RECEIPT", "SALE", "PAYMENT", "DISCOUNT", "OTHER"],
                },
                documentGroup: {
                  type: ["string", "null"],
                  description:
                    "Stable identifier shared by observations from the same receipt, invoice, payment or reimbursement line.",
                },
                label: { type: ["string", "null"] },
                amount: { type: ["string", "null"] },
                date: { type: ["string", "null"] },
                page: { type: ["integer", "null"], minimum: 1 },
                text: { type: ["string", "null"] },
                boundingBox: BOUNDING_BOX_JSON_SCHEMA,
              },
            },
          },
        },
      },
    },
    itemCoverage: {
      type: "object",
      additionalProperties: false,
      description:
        "Coverage of the single non-overlapping item layer used to reconcile the document total.",
      required: [
        "status",
        "declaredItemCount",
        "extractedItemCount",
        "firstLineNumber",
        "lastLineNumber",
        "missingLineNumbers",
        "evidence",
      ],
      properties: {
        status: {
          type: "string",
          enum: ["COMPLETE", "INCOMPLETE", "UNKNOWN"],
        },
        declaredItemCount: { type: ["integer", "null"], minimum: 0 },
        extractedItemCount: { type: "integer", minimum: 0 },
        firstLineNumber: { type: ["integer", "null"], minimum: 1 },
        lastLineNumber: { type: ["integer", "null"], minimum: 1 },
        missingLineNumbers: {
          type: "array",
          maxItems: 500,
          items: { type: "integer", minimum: 1 },
        },
        evidence: { type: ["string", "null"] },
      },
    },
    supportCoverage: {
      type: "object",
      additionalProperties: false,
      description:
        "Coverage of documents referenced by an aggregate charge. This is separate from item row coverage.",
      required: [
        "status",
        "referencedDocuments",
        "presentDocuments",
        "missingDocuments",
        "basis",
        "evidence",
      ],
      properties: {
        status: { type: "string", enum: ["COMPLETE", "PARTIAL", "UNKNOWN"] },
        referencedDocuments: {
          type: "array",
          maxItems: 200,
          items: { type: "string", minLength: 1 },
        },
        presentDocuments: {
          type: "array",
          maxItems: 200,
          items: { type: "string", minLength: 1 },
        },
        missingDocuments: {
          type: "array",
          maxItems: 200,
          items: { type: "string", minLength: 1 },
        },
        basis: {
          type: "string",
          enum: [
            "DOCUMENT_REFERENCES",
            "EXPLICIT_COMPLETENESS_STATEMENT",
            "NONE",
          ],
        },
        evidence: { type: ["string", "null"] },
      },
    },
    requiredFieldChecks: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "field",
          "label",
          "requiredByDocument",
          "requirementBasis",
          "requirementEvidence",
          "present",
          "page",
          "evidence",
          "boundingBox",
        ],
        properties: {
          field: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          requiredByDocument: { type: "boolean" },
          requirementBasis: {
            type: "string",
            enum: ["EXPLICIT_DOCUMENT", "VERIFIED_POLICY", "NONE"],
          },
          requirementEvidence: { type: ["string", "null"] },
          present: { type: "boolean" },
          page: { type: ["integer", "null"], minimum: 1 },
          evidence: { type: ["string", "null"] },
          boundingBox: BOUNDING_BOX_JSON_SCHEMA,
        },
      },
    },
    markdown: { type: "string", minLength: 1, maxLength: 12_000 },
    readConfidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", maxItems: 50, items: { type: "string" } },
  },
} as const;

export const INVOICE_EXTRACTION_SYSTEM_PROMPT = INVOICE_EXTRACTION_PROMPT.system;

import { z } from "zod";

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
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)))
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

const UNKNOWN_ITEM_COVERAGE = {
  status: "UNKNOWN" as const,
  declaredItemCount: null,
  extractedItemCount: 0,
  firstLineNumber: null,
  lastLineNumber: null,
  missingLineNumbers: [] as number[],
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
    present: z.boolean(),
    page: z.number().int().positive().nullable().default(null),
    evidence: nullableText,
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
      : numberOrNull(value.extractedItemCount ?? value.extracted_item_count) ?? items.length;
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
    };

    const parsed = invoiceEvidenceObservationSchema.safeParse(observation);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizedRequiredFieldChecks(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 50).flatMap((rawCheck) => {
    if (!isRecord(rawCheck)) return [];
    const requiredByDocument =
      rawCheck.requiredByDocument ??
      rawCheck.required_by_document ??
      rawCheck.required;
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

    const parsed = invoiceRequiredFieldCheckSchema.safeParse({
      field,
      label,
      requiredByDocument,
      present,
      page:
        typeof rawCheck.page === "number" &&
        Number.isSafeInteger(rawCheck.page) &&
        rawCheck.page > 0
          ? rawCheck.page
          : null,
      evidence: normalizeNullableText(
        rawCheck.evidence ?? rawCheck.text ?? rawCheck.excerpt,
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

/**
 * Normaliza apenas desvios estruturais seguros e comuns de modelos. Não cria
 * valores fiscais: campos ausentes continuam null, itens sem descrição são
 * descartados e a ordem observada vira a numeração canônica persistida.
 */
export function normalizeInvoiceExtractionPayload(value: unknown): unknown {
  const unwrapped = unwrapExtractionPayload(value);
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
  const direct = invoiceExtractionSchema.safeParse(value);
  if (direct.success) return direct;
  return invoiceExtractionSchema.safeParse(
    normalizeInvoiceExtractionPayload(value),
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
              required: ["kind", "documentGroup", "label", "amount", "date", "page", "text"],
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
          "present",
          "page",
          "evidence",
        ],
        properties: {
          field: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          requiredByDocument: { type: "boolean" },
          present: { type: "boolean" },
          page: { type: ["integer", "null"], minimum: 1 },
          evidence: { type: ["string", "null"] },
        },
      },
    },
    markdown: { type: "string", minLength: 1, maxLength: 12_000 },
    readConfidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", maxItems: 50, items: { type: "string" } },
  },
} as const;

export const INVOICE_EXTRACTION_SYSTEM_PROMPT = INVOICE_EXTRACTION_PROMPT.system;

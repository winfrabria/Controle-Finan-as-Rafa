import { z } from "zod";
import { isValidIsoCalendarDate } from "@/lib/calendar-date";

import type {
  DuplicateCandidate,
  HarnessFinding,
  HarnessInvoice,
  WorkRuleInput,
} from "./contracts";

const MONEY_TOLERANCE = 0.05;
const RELATIVE_MONEY_TOLERANCE = 0.0001;
const ALCOHOL_TERMS = [
  "cerveja", "chopp", "vinho", "whisky", "whiskey", "vodka", "cachaça",
  "cachaca", "gin ", "espumante", "licor", "tequila", "bebida alcoólica",
];
const HYGIENE_TERMS = [
  "shampoo", "condicionador", "desodorante", "sabonete", "creme dental",
  "pasta de dente", "escova de dente", "fio dental", "absorvente", "fralda",
  "papel higiênico", "papel higienico", "barbeador", "protetor solar",
];

const workRuleConfigurationSchema = z
  .object({
    forbiddenTerms: z.array(z.string().trim().min(1)).optional(),
    maxUnitPrice: z.number().nonnegative().optional(),
    maxTotalAmount: z.number().nonnegative().optional(),
    allowedSupplierTaxIds: z.array(z.string().trim().min(1)).optional(),
    dateRange: z
      .object({ from: z.string().date().optional(), to: z.string().date().optional() })
      .strict()
      .optional(),
  })
  .strict();

function decimal(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyTolerance(reference: number) {
  return Math.max(MONEY_TOLERANCE, Math.abs(reference) * RELATIVE_MONEY_TOLERANCE);
}

function discountReconcilesItem(
  description: string,
  calculated: number,
  total: number,
  tolerance: number,
) {
  if (calculated <= total || !/desconto/i.test(description)) return false;

  const discountMatch = description.match(
    /desconto[^\d]{0,12}(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)/i,
  );
  if (!discountMatch) return false;

  const normalized = discountMatch[1].includes(",")
    ? discountMatch[1].replaceAll(".", "").replace(",", ".")
    : discountMatch[1];
  const discount = Number(normalized);
  return Number.isFinite(discount) && Math.abs(calculated - discount - total) <= tolerance;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function sumItemTotals(items: HarnessInvoice["items"]) {
  const totals = items.map((item) => decimal(item.totalAmount));
  if (totals.length === 0 || totals.some((value) => value === null)) return null;
  return totals.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function hasCompleteItemCoverage(invoice: HarnessInvoice) {
  const coverage = invoice.itemCoverage;
  if (!coverage || coverage.status !== "COMPLETE") return false;
  if (coverage.extractedItemCount <= 0) return false;
  if (coverage.missingLineNumbers.length > 0) return false;
  if (coverage.firstLineNumber === null || coverage.lastLineNumber === null) {
    return false;
  }
  if (coverage.firstLineNumber > coverage.lastLineNumber) return false;

  const allLineNumbers = new Set(invoice.items.map((item) => item.lineNumber));
  for (
    let lineNumber = coverage.firstLineNumber;
    lineNumber <= coverage.lastLineNumber;
    lineNumber += 1
  ) {
    if (!allLineNumbers.has(lineNumber)) return false;
  }

  const hasExplicitLayer = invoice.items.some(
    (item) => item.countsTowardDocumentTotal !== undefined,
  );
  const selectedItems = hasExplicitLayer
    ? invoice.items.filter((item) => item.countsTowardDocumentTotal === true)
    : [...invoice.items];
  selectedItems.sort((left, right) => left.lineNumber - right.lineNumber);
  if (hasExplicitLayer && selectedItems.length === 0) return false;
  if (
    (invoice.documentKind === "REIMBURSEMENT" ||
      invoice.documentKind === "COMPOSITE") &&
    !hasExplicitLayer
  ) {
    return false;
  }
  if (coverage.extractedItemCount !== selectedItems.length) return false;
  if (selectedItems[0]?.lineNumber !== coverage.firstLineNumber) return false;
  if (selectedItems.at(-1)?.lineNumber !== coverage.lastLineNumber) return false;
  if (
    coverage.declaredItemCount !== null &&
    coverage.extractedItemCount < coverage.declaredItemCount
  ) {
    return false;
  }
  return true;
}

function reconcilesTotal(items: HarnessInvoice["items"], noteTotal: number) {
  const sum = sumItemTotals(items);
  return sum !== null && Math.abs(sum - noteTotal) <= moneyTolerance(noteTotal);
}

function hasCompositeEvidenceShape(invoice: HarnessInvoice) {
  if (
    invoice.documentKind === "REIMBURSEMENT" ||
    invoice.documentKind === "COMPOSITE"
  ) {
    return true;
  }

  const text = [...invoice.warnings, invoice.markdown].join(" ");
  if (
    /reembolso|reimbursement|comprovantes?|prestação de contas|expense report/i.test(
      text,
    )
  ) {
    return true;
  }

  const groups = new Map<string, Set<EvidenceObservation["kind"]>>();
  for (const item of invoice.items) {
    for (const observation of item.evidenceObservations ?? []) {
      const group = normalizeDocumentGroup(
        observation.documentGroup ?? item.documentGroup,
      );
      if (!group) continue;
      const kinds = groups.get(group) ?? new Set<EvidenceObservation["kind"]>();
      kinds.add(observation.kind);
      groups.set(group, kinds);
    }
  }
  return [...groups.values()].some((kinds) => kinds.size >= 2);
}

/**
 * A compound document can expose the same expense as a fiscal line, a
 * supporting summary and daily detail. Only one non-overlapping layer may be
 * summed against the document total. New extractions mark that layer
 * explicitly; the description fallback keeps older persisted extractions
 * reprocessable without reproducing the same amount two or three times.
 */
function selectItemsForDocumentTotal(
  invoice: HarnessInvoice,
  noteTotal: number,
) {
  const hasExplicitSelection = invoice.items.some(
    (item) => item.countsTowardDocumentTotal !== undefined,
  );
  if (hasExplicitSelection) {
    const selectedItems = invoice.items.filter(
      (item) => item.countsTowardDocumentTotal === true,
    );
    if (selectedItems.length > 0) {
      return {
        basis: "EXPLICIT_NON_OVERLAPPING_LAYER",
        items: selectedItems,
      };
    }

    // Uma camada explicitamente vazia invalida a alegação de cobertura
    // completa. Sem uma camada contabilizável não existe base determinística
    // segura para comparar a soma com o total declarado.
    return {
      basis: "INVALID_EMPTY_EXPLICIT_LAYER",
      items: selectedItems,
    };
  }

  if (hasCompositeEvidenceShape(invoice)) {
    // Em documentos compostos, ficha, recibo, pagamento e resumo podem
    // representar a mesma despesa. Sem uma camada não sobreposta marcada pela
    // extração, somar todas as linhas inventa valores como 3 x R$ 20,00.
    return {
      basis: "MISSING_EXPLICIT_NON_OVERLAPPING_LAYER",
      items: [],
    };
  }

  const fiscalItems = invoice.items.filter((item) => {
    const description = normalize(item.description);
    return /(^|\b)(nf-e|nfs-e|danfe|nota fiscal|linha fiscal|item fiscal|cupom fiscal)(\b|,)/.test(
      description,
    );
  });
  if (fiscalItems.length > 0 && reconcilesTotal(fiscalItems, noteTotal)) {
    return { basis: "LEGACY_FISCAL_LAYER", items: fiscalItems };
  }

  const summaryItems = invoice.items.filter((item) => {
    const description = normalize(item.description);
    return /\b(resumo|consolidado|totalizador)\b/.test(description);
  });
  if (summaryItems.length > 0 && reconcilesTotal(summaryItems, noteTotal)) {
    return { basis: "LEGACY_SUMMARY_LAYER", items: summaryItems };
  }

  return { basis: "ALL_ITEMS", items: invoice.items };
}

function normalizedItemGroup(
  item: HarnessInvoice["items"][number],
) {
  return normalizeDocumentGroup(
    item.documentGroup ??
      item.evidenceObservations?.find((observation) => observation.documentGroup)
        ?.documentGroup,
  );
}

function legacyAggregateCharge(item: HarnessInvoice["items"][number]) {
  const description = normalize(item.description);
  return (
    item.countsTowardDocumentTotal === true &&
    /\b(boleto|cobranca|fatura|pagamento consolidado)\b/.test(description) &&
    /\b(documentos?|notas?|nfs?|titulos?|parcelas?|referente|agrupa|consolidado)\b/.test(
      description,
    )
  );
}

function requiredDocumentFieldFindings(invoice: HarnessInvoice) {
  const explicitRequirementPattern =
    /(?:\*\s*$|\bobrigat[oó]ri[oa]s?\b|\bpreenchimento\s+obrigat[oó]rio\b|\brequired\s+field\b|\bmandatory\b)/i;
  const hasVerifiedRequirement = (
    check: NonNullable<HarnessInvoice["requiredFieldChecks"]>[number],
  ) => {
    if (!check.requiredByDocument) return false;
    const requirementEvidence = check.requirementEvidence?.trim() ?? "";
    const fieldEvidence = check.evidence?.trim() ?? "";
    if (!requirementEvidence || !fieldEvidence) return false;

    if (check.requirementBasis === "VERIFIED_POLICY") {
      return true;
    }
    if (check.requirementBasis === "EXPLICIT_DOCUMENT") {
      return explicitRequirementPattern.test(requirementEvidence);
    }
    // Dados antigos sem a base versionada são conservados, mas não podem
    // sustentar suspeita. A ausência isolada de requiredByDocument não prova
    // que o formulário ou a política realmente exigia o campo.
    return false;
  };
  const missing = (invoice.requiredFieldChecks ?? []).filter(
    (check) => hasVerifiedRequirement(check) && !check.present,
  );
  if (missing.length === 0) return [];

  const labels = [...new Set(missing.map((check) => check.label))];
  const documentLabels = [
    ...new Set(
      missing
        .filter((check) => check.requirementBasis === "EXPLICIT_DOCUMENT")
        .map((check) => check.label),
    ),
  ];
  const policyLabels = [
    ...new Set(
      missing
        .filter((check) => check.requirementBasis === "VERIFIED_POLICY")
        .map((check) => check.label),
    ),
  ];
  const basisDescriptions = [
    documentLabels.length > 0
      ? `O próprio documento declara como obrigatórios os campos: ${documentLabels.join(", ")}.`
      : null,
    policyLabels.length > 0
      ? `A política global verificada exige os campos: ${policyLabels.join(", ")}.`
      : null,
  ].filter((value): value is string => value !== null);
  const basisJustifications = [
    documentLabels.length > 0
      ? "A declaração explícita do documento e a evidência do campo mostram a ausência."
      : null,
    policyLabels.length > 0
      ? "A política global verificada e a evidência do campo mostram a ausência."
      : null,
  ].filter((value): value is string => value !== null);
  return [
    finding({
      code: "REQUIRED_DOCUMENT_FIELDS_MISSING",
      title: "Campos obrigatórios não foram preenchidos",
      description: basisDescriptions.join(" "),
      category: "DOCUMENT_COMPLETENESS",
      severity: "WARNING",
      confidence: 0.99,
      justification: basisJustifications.join(" "),
      references: missing.map(
        (check) => `${check.requirementBasis === "VERIFIED_POLICY" ? "POLITICA_VERIFICADA" : "DOCUMENTO"}:página:${check.page ?? "não identificada"}:campo:${check.field}`,
      ),
      evidence: {
        fields: missing.map((check) => ({
          label: check.label,
          page: check.page,
          evidence: check.evidence,
          requirementBasis: check.requirementBasis ?? "LEGACY_EXPLICIT_DOCUMENT",
          requirementEvidence: check.requirementEvidence ?? check.evidence,
          boundingBox: check.boundingBox ?? null,
        })),
        summary: `${labels.length} campo(s) obrigatório(s) sem preenchimento.`,
      },
      expectedValue: "Campos obrigatórios preenchidos",
      actualValue: labels.join(", "),
      noteItemLineNumber: null,
    }),
  ];
}

function finding(
  input: Omit<
    HarnessFinding,
    "source" | "references" | "comparisonMode" | "referenceBasis"
  > & {
    references?: HarnessFinding["references"];
    source?: HarnessFinding["source"];
    comparisonMode?: HarnessFinding["comparisonMode"];
    referenceBasis?: HarnessFinding["referenceBasis"];
  },
): HarnessFinding {
  return {
    references: ["POLITICA_AUDITORIA_VIGENTE"],
    source: "UNIVERSAL_RULE",
    comparisonMode:
      input.comparisonMode ??
      (input.expectedValue === null ? "CONFLICT" : "REFERENCE"),
    referenceBasis: input.referenceBasis ?? null,
    ...input,
  };
}

type EvidenceObservation = NonNullable<
  HarnessInvoice["items"][number]["evidenceObservations"]
>[number];

function observationIdentity(observation: EvidenceObservation) {
  return [
    observation.kind,
    observation.page ?? "",
    observation.label ?? "",
    observation.text ?? "",
  ]
    .join(":")
    .slice(0, 240);
}

function normalizeDocumentGroup(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR") || null;
}

function groupedAggregatePaymentFindings(
  items: HarnessInvoice["items"],
) {
  const groups = new Map<
    string,
    Array<{ item: HarnessInvoice["items"][number]; observation: EvidenceObservation }>
  >();

  for (const item of items) {
    for (const observation of item.evidenceObservations ?? []) {
      const group = normalizeDocumentGroup(
        observation.documentGroup ?? item.documentGroup,
      );
      if (!group) continue;
      const entries = groups.get(group) ?? [];
      entries.push({ item, observation });
      groups.set(group, entries);
    }
  }

  const reconciledObservations = new Set<EvidenceObservation>();
  const findings: HarnessFinding[] = [];

  for (const [group, entries] of groups) {
    const groupItems = [
      ...new Map(
        entries.map(({ item }) => [item.lineNumber, item]),
      ).values(),
    ];
    const aggregateItems = groupItems.filter(
      (item) =>
        item.documentRole === "AGGREGATE_PAYMENT" || legacyAggregateCharge(item),
    );
    const explicitlySelectedItems = groupItems.filter(
      (item) =>
        item.countsTowardDocumentTotal === true &&
        item.documentRole !== "AGGREGATE_PAYMENT" &&
        item.documentRole !== "SUMMARY" &&
        !legacyAggregateCharge(item),
    );
    // Uma comparação agregada só é segura quando a camada econômica foi
    // selecionada explicitamente. Sem essa marcação, LINE_ITEM pode ser apenas
    // o default do parser para ficha, recibo e pagamento sobrepostos.
    const economicItems = explicitlySelectedItems;
    const paymentEntries = entries.filter(
      ({ observation }) => observation.kind === "PAYMENT" && decimal(observation.amount) !== null,
    );

    const aggregateEconomicLines =
      economicItems.length > 0 &&
      (aggregateItems.length > 0 || economicItems.length >= 2);
    if (!aggregateEconomicLines) {
      const containsSummaryLayer = groupItems.some(
        (item) => item.documentRole === "SUMMARY",
      );

      // SUMMARY lines can be a consolidated total plus its daily breakdown.
      // Sharing a broad documentGroup does not prove that every amount/date is
      // the same transaction. Each line is still reconciled below against its
      // own evidence, but cross-line comparison is unsafe without an explicit
      // aggregate payment or more than one selected economic line.
      if (containsSummaryLayer) continue;

      const observations = [
        ...new Set(entries.map(({ observation }) => observation)),
      ];
      const comparableKinds = new Set(
        observations
          .filter((observation) => observation.kind !== "DISCOUNT")
          .map((observation) => observation.kind),
      );

      // Uma ficha de reembolso, a venda/recibo e o pagamento representam
      // camadas de evidência do mesmo evento. Sem uma cobrança agregada ou
      // várias linhas econômicas explícitas, somá-las inventaria despesas.
      if (comparableKinds.size >= 2) {
        const anchorItem =
          explicitlySelectedItems[0] ?? groupItems[0];
        if (anchorItem) {
          findings.push(
            ...reconcileEvidenceObservations({
              ...anchorItem,
              evidenceObservations: observations,
            }),
          );
          for (const observation of observations) {
            reconciledObservations.add(observation);
          }
        }
      }
      continue;
    }

    if (
      economicItems.length === 0 ||
      paymentEntries.length === 0
    ) {
      continue;
    }

    const itemTotal = sumItemTotals(economicItems);
    if (itemTotal === null || itemTotal === 0) continue;

    const aggregatePaymentEntries = paymentEntries.filter(({ item }) =>
      item.documentRole === "AGGREGATE_PAYMENT" || legacyAggregateCharge(item),
    );
    const comparedPaymentEntries =
      aggregatePaymentEntries.length > 0
        ? aggregatePaymentEntries
        : paymentEntries;
    const paymentInstances = new Map<
      string,
      typeof comparedPaymentEntries
    >();
    for (const entry of comparedPaymentEntries) {
      const identity = [
        entry.observation.documentGroup ?? "",
        entry.observation.page ?? "",
        entry.observation.date ?? "",
        entry.observation.amount ?? "",
        entry.observation.label ?? "",
        entry.observation.text ?? "",
      ].join(":");
      const instances = paymentInstances.get(identity) ?? [];
      instances.push(entry);
      paymentInstances.set(identity, instances);
    }

    const ambiguousInstances = [...paymentInstances.values()].filter(
      (instances) => instances.length > 1,
    );
    if (ambiguousInstances.length > 0) {
      const occurrences = ambiguousInstances.flat();
      for (const entry of occurrences) {
        // A associação do pagamento a uma linha também é incerta. Evita
        // compará-lo como se fosse o pagamento individual daquele item.
        reconciledObservations.add(entry.observation);
      }
      findings.push(
        finding({
          code: `AGGREGATE_PAYMENT_INSTANCE_AMBIGUITY_${group.replace(/[^a-z0-9]+/g, "_").slice(0, 48)}`,
          title: "Quantidade de pagamentos não pôde ser confirmada",
          description:
            "Há registros de pagamento estruturalmente idênticos sem identificador que permita confirmar se são parcelas distintas ou repetição da extração.",
          category: "DOCUMENT_COVERAGE",
          severity: "INFO",
          confidence: 0.99,
          justification:
            "Somar ou eliminar esses registros exigiria presumir uma identidade que não está comprovada no documento.",
          references: [
            ...new Set(
              occurrences.map(
                ({ observation }) =>
                  `DOCUMENTO:página:${observation.page ?? "não identificada"}:PAYMENT`,
              ),
            ),
          ],
          evidence: {
            documentGroup: group,
            ambiguousIdentityCount: ambiguousInstances.length,
            occurrenceCount: occurrences.length,
            lineNumbers: [
              ...new Set(occurrences.map(({ item }) => item.lineNumber)),
            ],
            pages: [
              ...new Set(
                occurrences
                  .map(({ observation }) => observation.page)
                  .filter((page): page is number => page !== null),
              ),
            ],
            summary:
              "A reconciliação agregada foi interrompida porque a quantidade de instâncias de pagamento é ambígua.",
          },
          expectedValue: "INSTANCIAS_DE_PAGAMENTO_IDENTIFICAVEIS",
          actualValue: `${occurrences.length} ocorrências sem identidade distinta`,
          noteItemLineNumber: null,
        }),
      );
      continue;
    }

    const uniquePayments = [...paymentInstances.values()].map(
      (instances) => instances[0],
    );
    const paymentTotal = uniquePayments.reduce((sum, entry) => {
      return sum + (decimal(entry.observation.amount) ?? 0);
    }, 0);
    if (paymentTotal === 0) continue;

    for (const entry of comparedPaymentEntries) {
      reconciledObservations.add(entry.observation);
    }

    const tolerance = moneyTolerance(paymentTotal);
    if (Math.abs(itemTotal - paymentTotal) <= tolerance) continue;

    findings.push(
      finding({
        code: `AGGREGATE_PAYMENT_MISMATCH_${group.replace(/[^a-z0-9]+/g, "_").slice(0, 48)}`,
        title: "Pagamento agregado diverge dos itens",
        description:
          "A soma dos produtos do mesmo documento não corresponde ao pagamento total apresentado.",
        category: "AMOUNTS",
        severity: "WARNING",
        confidence: 0.99,
        justification:
          "Os itens e o pagamento pertencem ao mesmo conjunto documental e a diferença excede a tolerância monetária.",
        references: [
          ...new Set(
            entries.map(
              ({ observation }) =>
                `DOCUMENTO:página:${observation.page ?? "não identificada"}:${observation.kind}`,
            ),
          ),
        ],
        evidence: {
          field: "valor",
          documentGroup: group,
          pages: [...new Set(entries.map(({ observation }) => observation.page).filter(Boolean))],
          summary: `${economicItems.length} itens somam R$ ${itemTotal.toFixed(2)}; ${uniquePayments.length} pagamento(s) somam R$ ${paymentTotal.toFixed(2)}.`,
        },
        expectedValue: itemTotal.toFixed(2),
        actualValue: paymentTotal.toFixed(2),
        noteItemLineNumber: null,
      }),
    );
  }

  return { findings, reconciledObservations };
}

function observationValue(observation: EvidenceObservation) {
  const parts = [
    observation.amount === null ? null : `R$ ${Number(observation.amount).toFixed(2)}`,
    observation.date === null ? null : observation.date,
  ].filter((value): value is string => Boolean(value));
  return parts.join(" · ");
}

function hasUnverifiedArithmeticMismatch(
  items: HarnessInvoice["items"],
) {
  return items.some((item) => {
    const quantity = decimal(item.quantity);
    const unitPrice = decimal(item.unitPrice);
    const total = decimal(item.totalAmount);
    if (quantity === null || unitPrice === null || total === null) return false;
    const calculated = quantity * unitPrice;
    const tolerance = moneyTolerance(total);
    return (
      item.arithmeticVerified !== true &&
      Math.abs(calculated - total) > tolerance &&
      !discountReconcilesItem(item.description, calculated, total, tolerance)
    );
  });
}

type ObservationAmountRole =
  | "TRANSACTION_TOTAL"
  | "ADJUSTMENT"
  | "COMPONENT"
  | "UNIT_VALUE"
  | "UNKNOWN";

type ObservationDateRole =
  | "TRANSACTION_DATE"
  | "EXPENSE_DATE"
  | "ISSUE_DATE"
  | "PAYMENT_DATE"
  | "DUE_DATE"
  | "PERIOD_DATE"
  | "UNKNOWN";

function observationSearchText(observation: EvidenceObservation) {
  return normalize([observation.label, observation.text].filter(Boolean).join(" "));
}

/**
 * Separates the value that represents the transaction from ancillary values
 * printed in the same document. A penalty, interest, freight or unit price is
 * not an alternative total and therefore cannot be compared with the boleto,
 * receipt or payment total.
 */
function observationAmountRole(
  observation: EvidenceObservation,
): ObservationAmountRole {
  const text = observationSearchText(observation);
  if (
    observation.kind === "DISCOUNT" ||
    /\b(desconto|abatimento|multa|juros|mora|encargo|acrescimo|acréscimo|taxa por atraso|penalidade|troco)\b/.test(
      text,
    )
  ) {
    return "ADJUSTMENT";
  }
  if (/\b(valor unitario|valor unitário|preco unitario|preço unitário|unit price)\b/.test(text)) {
    return "UNIT_VALUE";
  }
  if (/\b(frete|imposto|tributo|icms|ipi|iss|seguro|despesa acessoria|despesa acessória)\b/.test(text)) {
    return "COMPONENT";
  }
  if (["PAYMENT", "SALE", "RECEIPT", "SHEET"].includes(observation.kind)) {
    return "TRANSACTION_TOTAL";
  }
  if (/\b(valor (?:do )?documento|valor pago|total(?: geral)?|pagamento|pago|venda|pedido|recibo|reembolso)\b/.test(text)) {
    return "TRANSACTION_TOTAL";
  }
  return "UNKNOWN";
}

/**
 * Dates printed near the same transaction can have different meanings. In
 * particular, issue date, due date and penalty date are not contradictory.
 */
function observationDateRole(
  observation: EvidenceObservation,
): ObservationDateRole {
  const text = observationSearchText(observation);
  if (/\b(vencimento|vence|data limite|due date)\b/.test(text)) return "DUE_DATE";
  if (/\b(periodo|período|competencia|competência|de \d{1,2}\/\d{1,2}.* a \d{1,2}\/\d{1,2})\b/.test(text)) {
    return "PERIOD_DATE";
  }
  if (/\b(emissao|emissão|emitid[ao]|data do documento|data do doc|issue date)\b/.test(text)) {
    return "ISSUE_DATE";
  }
  if (
    observation.kind === "PAYMENT" ||
    /\b(pagamento|pago|transacao|transação|debito|débito|credito|crédito|pix|cartao|cartão)\b/.test(
      text,
    )
  ) {
    return "PAYMENT_DATE";
  }
  if (observation.kind === "SHEET" || /\b(ficha|controle|despesa|solicitacao|solicitação)\b/.test(text)) {
    return "EXPENSE_DATE";
  }
  if (observation.kind === "SALE" || observation.kind === "RECEIPT") {
    return "TRANSACTION_DATE";
  }
  return "UNKNOWN";
}

function compactDateValues(values: string[]) {
  const unique = [...new Set(values)].sort();
  if (unique.length <= 3) return unique.join(" × ");
  return `${unique[0]} a ${unique.at(-1)} (${unique.length} datas)`;
}

function explicitReferenceObservation(observation: EvidenceObservation) {
  return /\b(?:refer[eê]ncia|esperad[oa]|previst[oa]|contrat(?:o|ual)|valor\s+declarado)\b/iu.test(
    observationSearchText(observation),
  );
}

function amountReferenceGroup<T extends {
  observation: EvidenceObservation;
  value: number;
}>(entries: T[]) {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = entry.value.toFixed(2);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  for (const [value, group] of groups) {
    const kinds = new Set(group.map(({ observation }) => observation.kind));
    // Ficha + recibo são duas bases documentais independentes do valor
    // reembolsável. Ficha + pagamento, por outro lado, pode repetir um valor
    // informado e não transforma automaticamente a venda em incorreta.
    if (kinds.has("SHEET") && kinds.has("RECEIPT")) {
      return {
        value: Number(value),
        basis: "CORROBORATED_SHEET_AND_RECEIPT",
      };
    }
    if (group.some(({ observation }) => explicitReferenceObservation(observation))) {
      return {
        value: Number(value),
        basis: "EXPLICIT_DOCUMENT_REFERENCE",
      };
    }
  }
  return null;
}

function reconcileEvidenceObservations(
  item: HarnessInvoice["items"][number],
  ignoredObservations: Set<EvidenceObservation> = new Set(),
) {
  const observations = (item.evidenceObservations ?? []).filter(
    (observation) => !ignoredObservations.has(observation),
  );
  const findings: HarnessFinding[] = [];
  const amounts = observations.flatMap((observation) => {
    const value = decimal(observation.amount);
    return value === null ? [] : [{ observation, value }];
  });
  const dates = observations.flatMap((observation) =>
    observation.date === null || !isValidIsoCalendarDate(observation.date)
      ? []
      : [{ observation, value: observation.date }],
  );
  const discount = amounts
    .filter(({ observation }) => observation.kind === "DISCOUNT")
    .reduce((sum, entry) => sum + Math.abs(entry.value), 0);
  const comparableAmounts = amounts.filter(
    ({ observation }) =>
      observationAmountRole(observation) === "TRANSACTION_TOTAL",
  );

  if (comparableAmounts.length >= 2) {
    const highest = comparableAmounts.reduce((left, right) =>
      right.value > left.value ? right : left,
    );
    const lowest = comparableAmounts.reduce((left, right) =>
      right.value < left.value ? right : left,
    );
    const difference = highest.value - lowest.value;
    const tolerance = moneyTolerance(highest.value);
    const discountExplainsDifference =
      discount > 0 && Math.abs(difference - discount) <= tolerance;

    if (difference > tolerance && !discountExplainsDifference) {
      const reference = amountReferenceGroup(comparableAmounts);
      const conflicting = reference
        ? comparableAmounts.filter(
            (entry) =>
              Math.abs(entry.value - reference.value) >
              moneyTolerance(reference.value),
          )
        : comparableAmounts;
      const distinctValues = [
        ...new Set(comparableAmounts.map((entry) => entry.value.toFixed(2))),
      ];
      findings.push(
        finding({
          code: `EVIDENCE_AMOUNT_MISMATCH_${item.lineNumber}`,
          title: "Valores divergentes no mesmo comprovante",
          description: `O item ${item.lineNumber} apresenta valores diferentes entre ficha, venda, recibo ou pagamento.`,
          category: "AMOUNTS",
          severity: "WARNING",
          confidence: 0.99,
          justification:
            "Os valores conflitantes estão registrados no próprio anexo e não há desconto explícito que reconcilie a diferença.",
          references: [
            ...new Set(
              comparableAmounts.map(
                ({ observation }) =>
                  `DOCUMENTO:página:${observation.page ?? "não identificada"}:${observation.kind}`,
              ),
            ),
          ],
          evidence: {
            documentGroup:
              item.documentGroup ??
              comparableAmounts.find(
                ({ observation }) => observation.documentGroup !== null,
              )?.observation.documentGroup ??
              null,
            field: "valor",
            lineNumber: item.lineNumber,
            observations: comparableAmounts.map(({ observation }) => ({
              amount: observation.amount,
              date: observation.date,
              kind: observation.kind,
              label: observation.label,
              page: observation.page,
              text: observation.text,
            })),
            summary: comparableAmounts
              .map(
                ({ observation }) =>
                  `${observation.kind}: ${observationValue(observation)}`,
              )
              .join("; "),
          },
          comparisonMode: reference ? "REFERENCE" : "CONFLICT",
          referenceBasis: reference?.basis ?? null,
          expectedValue: reference ? reference.value.toFixed(2) : null,
          actualValue: reference
            ? (() => {
                const values = [
                  ...new Set(conflicting.map((entry) => entry.value.toFixed(2))),
                ];
                return values.length === 1 ? values[0] : values;
              })()
            : distinctValues,
          noteItemLineNumber: item.lineNumber,
        }),
      );
    }
  }

  const directComparableDates = dates.filter(({ observation }) => {
    const role = observationDateRole(observation);
    return (
      role === "TRANSACTION_DATE" ||
      role === "EXPENSE_DATE" ||
      role === "PAYMENT_DATE"
    );
  });
  const issueDates = dates.filter(
    ({ observation }) => observationDateRole(observation) === "ISSUE_DATE",
  );
  const expensePeriodDates = dates.filter(({ observation }) => {
    const role = observationDateRole(observation);
    return role === "EXPENSE_DATE" || role === "PERIOD_DATE";
  });
  const hasMaterialPeriodGap = issueDates.some((issue) =>
    expensePeriodDates.some((expense) => {
      const issueTime = Date.parse(`${issue.value}T00:00:00.000Z`);
      const expenseTime = Date.parse(`${expense.value}T00:00:00.000Z`);
      return (
        Number.isFinite(issueTime) &&
        Number.isFinite(expenseTime) &&
        Math.abs(issueTime - expenseTime) >= 180 * 24 * 60 * 60 * 1_000
      );
    }),
  );
  const comparableDates = hasMaterialPeriodGap
    ? [...new Set([
        ...directComparableDates,
        ...issueDates,
        ...expensePeriodDates,
      ])]
    : directComparableDates;
  const distinctDates = [
    ...new Map(comparableDates.map((entry) => [entry.value, entry])).values(),
  ];
  const comparableDateKinds = new Set(
    comparableDates.map(({ observation }) => observation.kind),
  );
  if (distinctDates.length >= 2 && comparableDateKinds.size >= 2) {
    const explicitReference = distinctDates.find(({ observation }) =>
      explicitReferenceObservation(observation),
    );
    findings.push(
      finding({
        code: `EVIDENCE_DATE_MISMATCH_${item.lineNumber}`,
        title: "Datas divergentes no mesmo comprovante",
        description: `O item ${item.lineNumber} apresenta datas diferentes entre ficha, venda, recibo ou pagamento.`,
        category: "DATES",
        severity: "WARNING",
        confidence: 0.99,
        justification:
          "As datas conflitantes estão registradas no próprio conjunto documental.",
        references: distinctDates.map(
          ({ observation }) =>
            `DOCUMENTO:página:${observation.page ?? "não identificada"}:${observationIdentity(observation)}`,
        ),
        evidence: {
          documentGroup:
            item.documentGroup ??
            distinctDates.find(
              ({ observation }) => observation.documentGroup !== null,
            )?.observation.documentGroup ??
            null,
          field: "data",
          lineNumber: item.lineNumber,
          observations: distinctDates.map(({ observation }) => ({
            date: observation.date,
            kind: observation.kind,
            label: observation.label,
            page: observation.page,
            text: observation.text,
          })),
          summary: distinctDates
            .map(
              ({ observation }) =>
                `${observation.kind}: ${observation.date ?? "data ausente"}`,
            )
            .join("; "),
        },
        comparisonMode: explicitReference ? "REFERENCE" : "CONFLICT",
        referenceBasis: explicitReference
          ? "EXPLICIT_DOCUMENT_REFERENCE"
          : null,
        expectedValue: explicitReference?.value ?? null,
        actualValue: explicitReference
          ? compactDateValues(
              distinctDates
                .filter((entry) => entry.value !== explicitReference.value)
                .map((entry) => entry.value),
            )
          : distinctDates.map((entry) => entry.value),
        noteItemLineNumber: item.lineNumber,
      }),
    );
  }

  return findings;
}

function validateCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calculate = (length: number) => {
    let weight = length - 7;
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * weight--;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
}

export function evaluateUniversalRules(input: {
  invoice: HarnessInvoice;
  duplicates?: DuplicateCandidate[];
  now?: Date;
}) {
  const { invoice } = input;
  const findings: HarnessFinding[] = [];
  const coveredAreas = new Set<string>();
  const noteTotal = decimal(invoice.totalAmount);
  const aggregatePayments = groupedAggregatePaymentFindings(invoice.items);
  findings.push(...aggregatePayments.findings);
  findings.push(...requiredDocumentFieldFindings(invoice));

  for (const item of invoice.items) {
    const reconciled = reconcileEvidenceObservations(
      item,
      aggregatePayments.reconciledObservations,
    );
    if ((item.evidenceObservations?.length ?? 0) > 0) {
      coveredAreas.add("COMPOSITE_EVIDENCE");
    }
    findings.push(...reconciled);
  }

  const totalSelection =
    noteTotal === null ? null : selectItemsForDocumentTotal(invoice, noteTotal);
  const itemTotalSum = totalSelection ? sumItemTotals(totalSelection.items) : null;
  if (
    noteTotal !== null &&
    itemTotalSum !== null &&
    hasCompleteItemCoverage(invoice) &&
    !hasUnverifiedArithmeticMismatch(totalSelection?.items ?? [])
  ) {
    coveredAreas.add("TOTALS");
    const tolerance = moneyTolerance(noteTotal);
    if (Math.abs(itemTotalSum - noteTotal) > tolerance) {
      findings.push(finding({
        code: "TOTAL_MISMATCH", title: "Total da nota diverge dos itens",
        description: "O total impresso no documento difere da soma calculada a partir dos itens que compõem o total.",
        category: "TOTALS", severity: "CRITICAL", confidence: 0.99,
        justification: "A diferença aritmética excede a tolerância monetária e proporcional da auditoria.",
        evidence: {
          itemTotalSum: itemTotalSum.toFixed(2),
          noteTotal: noteTotal.toFixed(2),
          reconciliationBasis: totalSelection?.basis,
          selectedLineNumbers: totalSelection?.items.map(
            (item) => item.lineNumber,
          ),
          documentGroups: [
            ...new Set(
              totalSelection?.items
                .map((item) => normalizedItemGroup(item))
                .filter((group): group is string => group !== null),
            ),
          ],
          summary: `O documento informa R$ ${noteTotal.toFixed(2)}, enquanto a soma dos itens considerados resulta em R$ ${itemTotalSum.toFixed(2)}.`,
          tolerance: tolerance.toFixed(2),
        },
        expectedValue: itemTotalSum.toFixed(2), actualValue: noteTotal.toFixed(2), noteItemLineNumber: null,
      }));
    }
  }

  for (const item of invoice.items) {
    const quantity = decimal(item.quantity);
    const unitPrice = decimal(item.unitPrice);
    const total = decimal(item.totalAmount);
    if (quantity === null || unitPrice === null || total === null) continue;
    if (item.arithmeticVerified === true) {
      coveredAreas.add("QUANTITY_TIMES_PRICE");
    }
    const calculated = quantity * unitPrice;
    const tolerance = moneyTolerance(total);
    if (
      Math.abs(calculated - total) > tolerance &&
      !discountReconcilesItem(item.description, calculated, total, tolerance) &&
      item.arithmeticVerified === true
    ) {
      findings.push(finding({
        code: "ITEM_ARITHMETIC_MISMATCH", title: "Quantidade vezes preço diverge",
        description: `No item ${item.lineNumber}, quantidade × valor unitário resulta em R$ ${calculated.toFixed(2)}, mas o total impresso é R$ ${total.toFixed(2)}.`,
        category: "QUANTITY_TIMES_PRICE", severity: "WARNING", confidence: 0.99,
        justification: "Quantidade multiplicada pelo preço unitário não coincide com o total do item.",
         evidence: {
           lineNumber: item.lineNumber,
           quantity,
           observations:
             item.sourcePage != null || Boolean(item.sourceText)
               ? [
                   {
                     amount: item.totalAmount,
                     date: null,
                     kind: "OTHER",
                     label: `Item ${item.lineNumber}`,
                     page: item.sourcePage ?? null,
                     text: item.sourceText ?? item.description,
                   },
                 ]
               : [],
           page: item.sourcePage ?? null,
           sourceText: item.sourceText ?? null,
           unitPrice,
          total,
          summary: `${quantity} × R$ ${unitPrice.toFixed(2)} = R$ ${calculated.toFixed(2)}; total impresso: R$ ${total.toFixed(2)}.`,
          tolerance: tolerance.toFixed(2),
        },
        expectedValue: calculated.toFixed(2), actualValue: total.toFixed(2),
        noteItemLineNumber: item.lineNumber,
      }));
    }
  }

  if (invoice.markdown) coveredAreas.add("DOCUMENT_TYPE");

  if (invoice.issuedAt && isValidIsoCalendarDate(invoice.issuedAt)) {
    coveredAreas.add("DATE");
    const issuedAt = Date.parse(`${invoice.issuedAt}T00:00:00.000Z`);
    const tomorrow = (input.now ?? new Date()).getTime() + 24 * 60 * 60 * 1_000;
    if (issuedAt > tomorrow) {
      findings.push(finding({
        code: "FUTURE_ISSUE_DATE", title: "Data de emissão futura",
        description: "A data da nota está além do dia seguinte ao processamento.",
        category: "DATE", severity: "WARNING", confidence: 0.98,
        justification: "Notas não devem apresentar emissão futura fora da tolerância de fuso.",
        evidence: { issuedAt: invoice.issuedAt, evaluatedAt: (input.now ?? new Date()).toISOString() },
        expectedValue: "DATA_ATUAL_OU_ANTERIOR", actualValue: invoice.issuedAt, noteItemLineNumber: null,
      }));
    }
  }

  if (invoice.supplierTaxId) {
    coveredAreas.add("CNPJ");
    if (!validateCnpj(invoice.supplierTaxId)) {
      findings.push(finding({
        code: "INVALID_CNPJ", title: "CNPJ inválido",
        description: "O identificador fiscal do fornecedor falhou na validação dos dígitos.",
        category: "CNPJ", severity: "WARNING", confidence: 0.99,
        justification: "O valor não possui um CNPJ válido pelos dígitos verificadores.",
        evidence: { supplierTaxId: invoice.supplierTaxId }, expectedValue: "CNPJ_VALIDO",
        actualValue: invoice.supplierTaxId, noteItemLineNumber: null,
      }));
    }
  }

  if (input.duplicates) {
    coveredAreas.add("DUPLICATE");
    const invoiceTotal = decimal(invoice.totalAmount);
    const normalizedDocumentNumber = invoice.documentNumber
      ?.replace(/[^\p{L}\p{N}]+/gu, "")
      .toLocaleLowerCase("pt-BR") || null;
    const normalizedSupplierTaxId = invoice.supplierTaxId?.replace(/\D/g, "") || null;
    const duplicate = input.duplicates.find((candidate) => {
      const candidateTotal = decimal(candidate.totalAmount);
      const candidateDocumentNumber = candidate.documentNumber
        ?.replace(/[^\p{L}\p{N}]+/gu, "")
        .toLocaleLowerCase("pt-BR") || null;
      const candidateSupplierTaxId = candidate.supplierTaxId?.replace(/\D/g, "") || null;
      const sameAmount =
        invoiceTotal !== null &&
        candidateTotal !== null &&
        Math.abs(invoiceTotal - candidateTotal) <= moneyTolerance(invoiceTotal);

      return (
        candidateDocumentNumber === normalizedDocumentNumber &&
        candidateSupplierTaxId === normalizedSupplierTaxId &&
        candidate.issuedAt === invoice.issuedAt &&
        sameAmount
      );
    });
    if (duplicate && (invoice.documentNumber || invoice.supplierTaxId)) {
      findings.push(finding({
        code: "POSSIBLE_DUPLICATE", title: "Possível nota duplicada",
        description: "Outra nota possui a mesma identidade fiscal e financeira.",
        category: "DUPLICATE", severity: "CRITICAL", confidence: 0.98,
        justification: "Número, fornecedor, data e valor coincidem com registro anterior.",
        evidence: { duplicateNoteId: duplicate.noteId }, expectedValue: "NOTA_UNICA",
        actualValue: duplicate.noteId, noteItemLineNumber: null,
      }));
    }
  }

  for (const item of invoice.items) {
    const description = normalize(item.description);
    const alcohol = ALCOHOL_TERMS.find((term) => description.includes(normalize(term)));
    const hygiene = HYGIENE_TERMS.find((term) => description.includes(normalize(term)));
    if (alcohol) {
      coveredAreas.add("ALCOHOL");
      findings.push(finding({
        code: "ALCOHOL_ITEM", title: "Bebida alcoólica identificada",
        description: `O item ${item.lineNumber} foi classificado como bebida alcoólica.`,
        category: "ALCOHOL", severity: "CRITICAL", confidence: 0.98,
        justification: "Bebidas alcoólicas são sempre suspeitas na política vigente.",
        evidence: { lineNumber: item.lineNumber, description: item.description, matchedTerm: alcohol },
        expectedValue: "ITEM_NAO_ALCOOLICO", actualValue: item.description,
        noteItemLineNumber: item.lineNumber,
      }));
    }
    if (hygiene) {
      coveredAreas.add("PERSONAL_HYGIENE");
      findings.push(finding({
        code: "PERSONAL_HYGIENE_ITEM", title: "Item de higiene pessoal identificado",
        description: `O item ${item.lineNumber} foi classificado como higiene pessoal.`,
        category: "PERSONAL_HYGIENE", severity: "CRITICAL", confidence: 0.97,
        justification: "Itens de higiene pessoal são sempre suspeitos na política vigente.",
        evidence: { lineNumber: item.lineNumber, description: item.description, matchedTerm: hygiene },
        expectedValue: "ITEM_NAO_HIGIENE_PESSOAL", actualValue: item.description,
        noteItemLineNumber: item.lineNumber,
      }));
    }
  }
  if (hasCompleteItemCoverage(invoice)) {
    coveredAreas.add("ALCOHOL");
    coveredAreas.add("PERSONAL_HYGIENE");
  }

  return { findings, coveredAreas: [...coveredAreas], covered: coveredAreas.size >= 3 };
}

export function evaluateWorkRules(invoice: HarnessInvoice, rules: WorkRuleInput[]) {
  const findings: HarnessFinding[] = [];
  const invalidRules: Array<{ code: string; issuePaths: string[] }> = [];
  let evaluated = 0;

  for (const rule of rules) {
    const parsed = workRuleConfigurationSchema.safeParse(rule.configuration);
    if (!parsed.success) {
      // Somente o identificador e os caminhos inválidos são retornados. A
      // configuração pode conter dados internos e nunca entra no diagnóstico.
      invalidRules.push({
        code: rule.code.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100),
        issuePaths: [
          ...new Set(
            parsed.error.issues.map(
              (issue) => issue.path.join(".") || "configuration",
            ),
          ),
        ],
      });
      continue;
    }
    const configuration = parsed.data;
    evaluated += 1;
    const severity = rule.severity;
    const add = (
      details: Omit<HarnessFinding, "source" | "severity" | "references">,
    ) =>
      findings.push({
        ...details,
        references: [`REGRA_OBRA:${rule.code}`],
        source: "WORK_RULE",
        severity,
      });

    if (configuration.maxTotalAmount !== undefined) {
      const total = decimal(invoice.totalAmount);
      if (total !== null && total > configuration.maxTotalAmount) add({
        code: `${rule.code}_MAX_TOTAL`, title: rule.name,
        description: "O total da nota excede o limite configurado para a obra.",
        category: rule.category, confidence: 0.99,
        justification: "O valor extraído supera o parâmetro ativo da obra.",
        evidence: { total, limit: configuration.maxTotalAmount, ruleCode: rule.code },
        expectedValue: configuration.maxTotalAmount, actualValue: total, noteItemLineNumber: null,
      });
    }
    for (const item of invoice.items) {
      const normalizedDescription = normalize(item.description);
      const term = configuration.forbiddenTerms?.find((value) =>
        normalizedDescription.includes(normalize(value)),
      );
      if (term) add({
        code: `${rule.code}_FORBIDDEN_TERM`, title: rule.name,
        description: `O item ${item.lineNumber} contém termo proibido pela obra.`,
        category: rule.category, confidence: 0.98,
        justification: "A descrição coincide com uma restrição ativa da obra.",
        evidence: { lineNumber: item.lineNumber, matchedTerm: term, ruleCode: rule.code },
        expectedValue: "TERMO_PERMITIDO", actualValue: item.description,
        noteItemLineNumber: item.lineNumber,
      });
      const unitPrice = decimal(item.unitPrice);
      if (configuration.maxUnitPrice !== undefined && unitPrice !== null && unitPrice > configuration.maxUnitPrice) add({
        code: `${rule.code}_MAX_UNIT_PRICE`, title: rule.name,
        description: `O preço unitário do item ${item.lineNumber} excede o limite da obra.`,
        category: rule.category, confidence: 0.99,
        justification: "O preço unitário extraído supera o parâmetro ativo.",
        evidence: { lineNumber: item.lineNumber, unitPrice, limit: configuration.maxUnitPrice, ruleCode: rule.code },
        expectedValue: configuration.maxUnitPrice, actualValue: unitPrice,
        noteItemLineNumber: item.lineNumber,
      });
    }
    if (configuration.allowedSupplierTaxIds && invoice.supplierTaxId &&
      !configuration.allowedSupplierTaxIds.includes(invoice.supplierTaxId)) add({
      code: `${rule.code}_SUPPLIER`, title: rule.name,
      description: "O fornecedor não está na lista permitida para a obra.",
      category: rule.category, confidence: 0.99,
      justification: "O CNPJ extraído não corresponde aos fornecedores configurados.",
      evidence: { supplierTaxId: invoice.supplierTaxId, ruleCode: rule.code },
      expectedValue: configuration.allowedSupplierTaxIds, actualValue: invoice.supplierTaxId,
      noteItemLineNumber: null,
    });
    if (configuration.dateRange && invoice.issuedAt && isValidIsoCalendarDate(invoice.issuedAt)) {
      const { from, to } = configuration.dateRange;
      if ((from && invoice.issuedAt < from) || (to && invoice.issuedAt > to)) add({
        code: `${rule.code}_DATE_RANGE`, title: rule.name,
        description: "A emissão está fora do período permitido para a obra.",
        category: rule.category, confidence: 0.99,
        justification: "A data extraída não está contida no intervalo ativo.",
        evidence: { issuedAt: invoice.issuedAt, from: from ?? null, to: to ?? null, ruleCode: rule.code },
        expectedValue: configuration.dateRange, actualValue: invoice.issuedAt,
        noteItemLineNumber: null,
      });
    }
  }

  return {
    findings,
    covered: evaluated > 0,
    evaluatedRules: evaluated,
    invalidRules,
  };
}

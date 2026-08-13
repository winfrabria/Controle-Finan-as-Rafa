import { z } from "zod";

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
  if (!discountMatch) {
    // A descrição confirma que o total é líquido de desconto, mas não permite
    // uma conferência determinística. A auditoria da IA continua responsável
    // por validar o comprovante sem gerar um falso positivo aritmético local.
    return true;
  }

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

function reconcilesTotal(items: HarnessInvoice["items"], noteTotal: number) {
  const sum = sumItemTotals(items);
  return sum !== null && Math.abs(sum - noteTotal) <= moneyTolerance(noteTotal);
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
    return {
      basis: "EXPLICIT_NON_OVERLAPPING_LAYER",
      items: invoice.items.filter((item) => item.countsTowardDocumentTotal === true),
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

function legacySupportingDocument(item: HarnessInvoice["items"][number]) {
  if (item.countsTowardDocumentTotal !== false) return false;
  const description = normalize(item.description);
  return /\b(nf-e|nfs-e|danfe|nota fiscal|cupom fiscal|documento fiscal)\b/.test(
    description,
  );
}

/**
 * Reconcilia qualquer cobrança agregada com seus documentos de suporte. A
 * regra depende do papel e do grupo documental extraídos, nunca de fornecedor,
 * número ou valor específicos. O reconhecimento textual existe apenas para
 * reprocessar extrações legadas que ainda não possuem esses campos.
 */
function compositeDocumentCoverageFindings(invoice: HarnessInvoice) {
  if (invoice.documentKind !== "COMPOSITE") return [];

  const aggregateItems = invoice.items.filter(
    (item) =>
      item.documentRole === "AGGREGATE_PAYMENT" || legacyAggregateCharge(item),
  );
  const findings: HarnessFinding[] = [];

  for (const aggregateItem of aggregateItems) {
    const aggregateTotal = decimal(aggregateItem.totalAmount);
    if (aggregateTotal === null) continue;

    const group = normalizedItemGroup(aggregateItem);
    const supportingItems = invoice.items.filter((item) => {
      if (item === aggregateItem) return false;
      const support =
        item.documentRole === "SUPPORTING_DOCUMENT" ||
        legacySupportingDocument(item);
      if (!support) return false;

      const supportGroup = normalizedItemGroup(item);
      return group === null || supportGroup === null || supportGroup === group;
    });
    const supportingTotal = sumItemTotals(supportingItems);
    if (supportingTotal === null) continue;

    const tolerance = moneyTolerance(aggregateTotal);
    if (Math.abs(aggregateTotal - supportingTotal) <= tolerance) continue;

    findings.push(
      finding({
        code: `COMPOSITE_PAYMENT_DOCUMENT_GAP${group ? `_${group.replace(/[^a-z0-9]+/g, "_").slice(0, 48)}` : ""}`,
        title: "Cobrança não está totalmente comprovada no anexo",
        description:
          "O valor da cobrança agregada é diferente do total dos documentos de suporte disponíveis para conferência.",
        category: "DOCUMENT_COVERAGE",
        severity: "CRITICAL",
        confidence: 0.99,
        justification:
          "A cobrança e os documentos de suporte pertencem ao mesmo conjunto documental, mas os valores não reconciliam dentro da tolerância.",
        references: [
          "DOCUMENTO:COBRANCA_AGREGADA",
          "DOCUMENTO:SUPORTES_DISPONIVEIS",
        ],
        evidence: {
          documentGroup: group,
          aggregateDescription: aggregateItem.description,
          aggregateTotal: aggregateTotal.toFixed(2),
          supportingTotal: supportingTotal.toFixed(2),
          unsupportedAmount: (aggregateTotal - supportingTotal).toFixed(2),
          supportingDocumentCount: supportingItems.length,
        },
        expectedValue: aggregateTotal.toFixed(2),
        actualValue: supportingTotal.toFixed(2),
        noteItemLineNumber: aggregateItem.lineNumber,
      }),
    );
  }

  return findings;
}

function requiredDocumentFieldFindings(invoice: HarnessInvoice) {
  const missing = (invoice.requiredFieldChecks ?? []).filter(
    (check) => check.requiredByDocument && !check.present,
  );
  if (missing.length === 0) return [];

  const labels = [...new Set(missing.map((check) => check.label))];
  return [
    finding({
      code: "REQUIRED_DOCUMENT_FIELDS_MISSING",
      title: "Campos obrigatórios não foram preenchidos",
      description: `O próprio documento declara como obrigatórios os campos: ${labels.join(", ")}.`,
      category: "DOCUMENT_COMPLETENESS",
      severity: "WARNING",
      confidence: 0.99,
      justification:
        "A exigência está registrada no formulário enviado e os campos correspondentes estão vazios.",
      references: missing.map(
        (check) =>
          `DOCUMENTO:página:${check.page ?? "não identificada"}:campo:${check.field}`,
      ),
      evidence: {
        fields: missing.map((check) => ({
          label: check.label,
          page: check.page,
          evidence: check.evidence,
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
  input: Omit<HarnessFinding, "source" | "references"> & {
    references?: HarnessFinding["references"];
    source?: HarnessFinding["source"];
  },
): HarnessFinding {
  return { references: ["POLITICA_AUDITORIA_VIGENTE"], source: "UNIVERSAL_RULE", ...input };
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
      const group = normalizeDocumentGroup(observation.documentGroup);
      if (!group) continue;
      const entries = groups.get(group) ?? [];
      entries.push({ item, observation });
      groups.set(group, entries);
    }
  }

  const reconciledObservations = new Set<EvidenceObservation>();
  const findings: HarnessFinding[] = [];

  for (const [group, entries] of groups) {
    const uniqueItems = [...new Map(entries.map((entry) => [entry.item.lineNumber, entry.item])).values()];
    const paymentEntries = entries.filter(
      ({ observation }) => observation.kind === "PAYMENT" && decimal(observation.amount) !== null,
    );
    if (uniqueItems.length < 2 || paymentEntries.length === 0) continue;

    const itemTotal = uniqueItems.reduce((sum, item) => {
      const total = decimal(item.totalAmount);
      return total === null ? sum : sum + total;
    }, 0);
    const uniquePayments = [
      ...new Map(
        paymentEntries.map((entry) => [
          `${entry.observation.page ?? ""}:${entry.observation.amount}`,
          entry,
        ]),
      ).values(),
    ];
    const paymentTotal = decimal(uniquePayments[0]?.observation.amount);
    if (paymentTotal === null || itemTotal === 0) continue;

    for (const entry of paymentEntries) reconciledObservations.add(entry.observation);

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
          summary: `${uniqueItems.length} itens somam R$ ${itemTotal.toFixed(2)}; pagamento de R$ ${paymentTotal.toFixed(2)}.`,
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

const EVIDENCE_BASELINE_PRIORITY: Record<EvidenceObservation["kind"], number> = {
  SALE: 0,
  RECEIPT: 1,
  SHEET: 2,
  PAYMENT: 3,
  OTHER: 4,
  DISCOUNT: 5,
};

function baselineObservation<T extends { observation: EvidenceObservation }>(
  entries: T[],
) {
  return [...entries].sort(
    (left, right) =>
      EVIDENCE_BASELINE_PRIORITY[left.observation.kind] -
      EVIDENCE_BASELINE_PRIORITY[right.observation.kind],
  )[0];
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
    observation.date === null ? [] : [{ observation, value: observation.date }],
  );
  const discount = amounts
    .filter(({ observation }) => observation.kind === "DISCOUNT")
    .reduce((sum, entry) => sum + Math.abs(entry.value), 0);
  const comparableAmounts = amounts.filter(
    ({ observation }) => observation.kind !== "DISCOUNT",
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
      const baseline = baselineObservation(comparableAmounts) ?? lowest;
      const conflicting = comparableAmounts.filter(
        (entry) =>
          Math.abs(entry.value - baseline.value) >
          moneyTolerance(baseline.value),
      );
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
          expectedValue: baseline.value.toFixed(2),
          actualValue: conflicting
            .map((entry) => entry.value.toFixed(2))
            .join(" × "),
          noteItemLineNumber: item.lineNumber,
        }),
      );
    }
  }

  const distinctDates = [
    ...new Map(dates.map((entry) => [entry.value, entry])).values(),
  ];
  if (distinctDates.length >= 2) {
    const baseline = baselineObservation(distinctDates) ?? distinctDates[0];
    const conflicting = distinctDates.filter(
      (entry) => entry.value !== baseline.value,
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
        expectedValue: baseline.value,
        actualValue: conflicting.map((entry) => entry.value).join(" × "),
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
  findings.push(...compositeDocumentCoverageFindings(invoice));
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
  if (noteTotal !== null && itemTotalSum !== null) {
    coveredAreas.add("TOTALS");
    const tolerance = moneyTolerance(noteTotal);
    if (Math.abs(itemTotalSum - noteTotal) > tolerance) {
      findings.push(finding({
        code: "TOTAL_MISMATCH", title: "Total da nota diverge dos itens",
        description: "A soma dos itens não corresponde ao total extraído da nota.",
        category: "TOTALS", severity: "CRITICAL", confidence: 0.99,
        justification: "A diferença aritmética excede a tolerância monetária e proporcional da auditoria.",
        evidence: {
          itemTotalSum: itemTotalSum.toFixed(2),
          noteTotal: noteTotal.toFixed(2),
          reconciliationBasis: totalSelection?.basis,
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
    coveredAreas.add("QUANTITY_TIMES_PRICE");
    const calculated = quantity * unitPrice;
    const tolerance = moneyTolerance(total);
    if (
      Math.abs(calculated - total) > tolerance &&
      !discountReconcilesItem(item.description, calculated, total, tolerance)
    ) {
      findings.push(finding({
        code: "ITEM_ARITHMETIC_MISMATCH", title: "Quantidade vezes preço diverge",
        description: `O item ${item.lineNumber} possui cálculo incompatível.`,
        category: "QUANTITY_TIMES_PRICE", severity: "WARNING", confidence: 0.99,
        justification: "Quantidade multiplicada pelo preço unitário não coincide com o total do item.",
        evidence: { lineNumber: item.lineNumber, quantity, unitPrice, total, tolerance: tolerance.toFixed(2) },
        expectedValue: calculated.toFixed(2), actualValue: total.toFixed(2),
        noteItemLineNumber: item.lineNumber,
      }));
    }
  }

  if (invoice.markdown) coveredAreas.add("DOCUMENT_TYPE");

  if (invoice.issuedAt) {
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
    const duplicate = input.duplicates.find((candidate) =>
      candidate.documentNumber === invoice.documentNumber &&
      candidate.supplierTaxId === invoice.supplierTaxId &&
      candidate.totalAmount === invoice.totalAmount &&
      candidate.issuedAt === invoice.issuedAt,
    );
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
  if (invoice.items.length > 0) {
    coveredAreas.add("ALCOHOL");
    coveredAreas.add("PERSONAL_HYGIENE");
  }

  return { findings, coveredAreas: [...coveredAreas], covered: coveredAreas.size >= 3 };
}

export function evaluateWorkRules(invoice: HarnessInvoice, rules: WorkRuleInput[]) {
  const findings: HarnessFinding[] = [];
  let evaluated = 0;

  for (const rule of rules) {
    const parsed = workRuleConfigurationSchema.safeParse(rule.configuration);
    if (!parsed.success) continue;
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
    if (configuration.dateRange && invoice.issuedAt) {
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

  return { findings, covered: evaluated > 0, evaluatedRules: evaluated };
}

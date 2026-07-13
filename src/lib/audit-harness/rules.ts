import { z } from "zod";

import type {
  DuplicateCandidate,
  HarnessFinding,
  HarnessInvoice,
  WorkRuleInput,
} from "./contracts";

const MONEY_TOLERANCE = 0.02;
const ALCOHOL_TERMS = [
  "cerveja", "chopp", "vinho", "whisky", "whiskey", "vodka", "cachaça",
  "cachaca", "gin ", "espumante", "licor", "tequila", "bebida alcoólica",
];
const HYGIENE_TERMS = [
  "shampoo", "condicionador", "desodorante", "sabonete", "creme dental",
  "pasta de dente", "escova de dente", "fio dental", "absorvente", "fralda",
  "papel higiênico", "papel higienico", "barbeador", "protetor solar",
];
const NON_FISCAL_TERMS = ["orçamento", "orcamento", "pedido", "pré-venda", "pre-venda"];

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

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function finding(
  input: Omit<HarnessFinding, "source" | "references"> & {
    references?: HarnessFinding["references"];
    source?: HarnessFinding["source"];
  },
): HarnessFinding {
  return { references: ["POLITICA_AUDITORIA_VIGENTE"], source: "UNIVERSAL_RULE", ...input };
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

  const itemTotals = invoice.items.map((item) => decimal(item.totalAmount));
  if (noteTotal !== null && itemTotals.length > 0 && itemTotals.every((value) => value !== null)) {
    coveredAreas.add("TOTALS");
    const sum = itemTotals.reduce<number>((acc, value) => acc + (value ?? 0), 0);
    if (Math.abs(sum - noteTotal) > MONEY_TOLERANCE) {
      findings.push(finding({
        code: "TOTAL_MISMATCH", title: "Total da nota diverge dos itens",
        description: "A soma dos itens não corresponde ao total extraído da nota.",
        category: "TOTALS", severity: "CRITICAL", confidence: 0.99,
        justification: "A diferença aritmética excede a tolerância de dois centavos.",
        evidence: { itemTotalSum: sum.toFixed(2), noteTotal: noteTotal.toFixed(2) },
        expectedValue: sum.toFixed(2), actualValue: noteTotal.toFixed(2), noteItemLineNumber: null,
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
    if (Math.abs(calculated - total) > MONEY_TOLERANCE) {
      findings.push(finding({
        code: "ITEM_ARITHMETIC_MISMATCH", title: "Quantidade vezes preço diverge",
        description: `O item ${item.lineNumber} possui cálculo incompatível.`,
        category: "QUANTITY_TIMES_PRICE", severity: "WARNING", confidence: 0.99,
        justification: "Quantidade multiplicada pelo preço unitário não coincide com o total do item.",
        evidence: { lineNumber: item.lineNumber, quantity, unitPrice, total },
        expectedValue: calculated.toFixed(2), actualValue: total.toFixed(2),
        noteItemLineNumber: item.lineNumber,
      }));
    }
  }

  const fiscalText = normalize(`${invoice.markdown} ${invoice.warnings.join(" ")}`);
  if (invoice.markdown) coveredAreas.add("DOCUMENT_TYPE");
  const nonFiscalTerm = NON_FISCAL_TERMS.find((term) => fiscalText.includes(normalize(term)));
  if (nonFiscalTerm) {
    findings.push(finding({
      code: "NON_FISCAL_DOCUMENT", title: "Documento pode não ser nota ou cupom fiscal",
      description: "O conteúdo extraído apresenta marcador de documento não fiscal.",
      category: "DOCUMENT_TYPE", severity: "CRITICAL", confidence: 0.9,
      justification: `Foi identificado o marcador '${nonFiscalTerm}' no conteúdo extraído.`,
      evidence: { matchedTerm: nonFiscalTerm }, expectedValue: "NOTA_OU_CUPOM_FISCAL",
      actualValue: nonFiscalTerm, noteItemLineNumber: null,
    }));
  }

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

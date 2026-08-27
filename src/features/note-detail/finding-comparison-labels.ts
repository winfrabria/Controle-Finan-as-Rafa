import type { NoteDetailFinding } from "./data";
import { extractFindingEvidenceObservations } from "./finding-observations";

export type FindingComparisonLabels = {
  actual: string;
  expected: string;
};

const DEFAULT_LABELS: FindingComparisonLabels = {
  actual: "Encontrado",
  expected: "Esperado / referência",
};

const CONTRACT_ITEM_LABELS: FindingComparisonLabels = {
  actual: "Item encontrado na nota",
  expected: "Item previsto no contrato",
};

type FindingComparisonInput = Pick<
  NoteDetailFinding,
  | "actualValue"
  | "affectedItem"
  | "category"
  | "code"
  | "evidence"
  | "expectedValue"
  | "rule"
  | "title"
>;

/**
 * Selects reviewer-facing comparison labels from the finding structure.
 * Contract, payment, date and fiscal-sheet checks receive labels that name the
 * compared documents instead of exposing generic expected/found terminology.
 */
export function findingComparisonLabels(
  finding: FindingComparisonInput,
): FindingComparisonLabels {
  const code = finding.code.toUpperCase();
  if (code === "TOTAL_MISMATCH") {
    return {
      actual: "Total encontrado no documento",
      expected: "Soma calculada dos itens",
    };
  }
  if (code === "ITEM_ARITHMETIC_MISMATCH") {
    return {
      actual: "Total encontrado no item",
      expected: "Quantidade × valor unitário",
    };
  }
  if (code.startsWith("EVIDENCE_DATE_MISMATCH_")) {
    return {
      actual: "Data encontrada no comprovante",
      expected: "Data de referência",
    };
  }
  if (
    code.startsWith("EVIDENCE_AMOUNT_MISMATCH_") ||
    code.startsWith("AGGREGATE_PAYMENT_MISMATCH_")
  ) {
    return {
      actual: "Valor encontrado",
      expected: "Valor de referência",
    };
  }

  const primaryStructure = normalizeStructure([
    finding.category,
    finding.code,
    finding.title,
    finding.rule?.code,
    finding.rule?.name,
  ]);
  const structure = normalizeStructure([
    primaryStructure,
    ...collectJsonKeys(finding.evidence),
    ...collectJsonKeys(finding.expectedValue),
    ...collectJsonKeys(finding.actualValue),
  ]);
  const evidenceField = normalizeStructure([
    extractEvidenceField(finding.evidence),
  ]);

  const isContractual = /\bcontrat/.test(structure);
  const concernsItem =
    Boolean(finding.affectedItem) ||
    /\b(item|itens|material|materiais|produto|produtos)\b/.test(structure);
  const comparesMeasuredValue =
    /\b(quantidade|quantitativo|valor|preco|percentual|total|data|emissao|vencimento|validade|periodo|prazo|volume|medicao|medido|executado|limite|tolerancia|amount|price|date|issued|due|quantity)\b/.test(
      structure,
    );

  const observationKinds = new Set(
    extractFindingEvidenceObservations(finding.evidence).map(
      (observation) => observation.kind,
    ),
  );
  const hasSheet =
    observationKinds.has("SHEET") || /\b(ficha|sheet)\b/.test(structure);
  const hasPayment =
    observationKinds.has("PAYMENT") ||
    /\b(pagamento|pago|cartao|debito|credito|payment)\b/.test(structure);
  const hasSaleOrReceipt =
    observationKinds.has("SALE") ||
    observationKinds.has("RECEIPT") ||
    /\b(venda|pedido|recibo|cupom|sale|receipt)\b/.test(structure);
  const explicitlyComparesMoney =
    /\b(valor|total|preco|amount|price|payment)\b/.test(evidenceField) ||
    /\b(valor|total|preco|amount|price|payment)\b/.test(primaryStructure);
  const comparesDate =
    /\b(data|date|emissao|issued|periodo|vencimento|validade|due)\b/.test(
      evidenceField,
    ) ||
    (!explicitlyComparesMoney &&
      /\b(data|emissao|periodo|vencimento|validade|date|issued|due)\b/.test(
        primaryStructure,
      ));
  const comparesFiscalDocumentWithSheet =
    hasSheet && /\b(fiscal|nota fiscal|nfe|danfe|linha fiscal)\b/.test(structure);

  if (comparesFiscalDocumentWithSheet && !comparesDate) {
    return { actual: "Ficha", expected: "Nota fiscal" };
  }

  if (comparesDate) {
    if (hasSheet && (hasPayment || hasSaleOrReceipt)) {
      return { actual: "Data do comprovante", expected: "Data da ficha" };
    }
    if (/\bemissao\b/.test(structure) && /\b(ficha|periodo)\b/.test(structure)) {
      return { actual: "Período detalhado na ficha", expected: "Data de emissão" };
    }
    return { actual: "Data encontrada", expected: "Data de referência" };
  }

  if (hasPayment) {
    const expected =
      hasSheet && hasSaleOrReceipt
        ? "Ficha / venda ou recibo"
        : hasSheet
          ? "Ficha"
          : hasSaleOrReceipt
            ? "Venda ou recibo"
            : "Valor do documento";
    return { actual: "Pagamento", expected };
  }

  return isContractual && concernsItem && !comparesMeasuredValue
    ? CONTRACT_ITEM_LABELS
    : DEFAULT_LABELS;
}

function extractEvidenceField(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>).field;
  return typeof field === "string" ? field : null;
}

export function findingComparisonDifference(
  finding: FindingComparisonInput,
): string | null {
  const structure = normalizeStructure([
    finding.category,
    finding.code,
    finding.title,
    finding.rule?.code,
    finding.rule?.name,
  ]);
  if (!/\b(valor|preco|total|pagamento|debito|credito|amount|price|payment)\b/.test(structure)) {
    return null;
  }

  const expected = extractComparableNumber(finding.expectedValue);
  const actual = extractComparableNumber(finding.actualValue);
  if (expected === null || actual === null) return null;

  const difference = Math.abs(expected - actual);
  if (difference < 0.005) return null;

  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(difference);
}

function collectJsonKeys(value: unknown, depth = 0): string[] {
  if (!value || depth > 3) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonKeys(entry, depth + 1));
  }
  if (typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...collectJsonKeys(entry, depth + 1),
  ]);
}

function normalizeStructure(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function extractComparableNumber(value: unknown): number | null {
  const scalar = parseComparableNumber(value);
  if (scalar !== null) return scalar;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const entries = Object.entries(value);
  const monetaryValues = uniqueNumbers(
    entries
      .filter(([key]) =>
        /(?:amount|valor|total|price|preco|preço|cost|custo|expected|actual)/i.test(
          key,
        ),
      )
      .flatMap(([, entry]) => collectComparableNumbers(entry)),
  );
  if (monetaryValues.length === 1) return monetaryValues[0] ?? null;

  const allValues = uniqueNumbers(entries.flatMap(([, entry]) => collectComparableNumbers(entry)));
  return allValues.length === 1 ? (allValues[0] ?? null) : null;
}

function collectComparableNumbers(value: unknown, depth = 0): number[] {
  const scalar = parseComparableNumber(value);
  if (scalar !== null) return [scalar];
  if (depth > 2 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectComparableNumbers(entry, depth + 1));
  }
  return Object.values(value).flatMap((entry) =>
    collectComparableNumbers(entry, depth + 1),
  );
}

function parseComparableNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const raw = value.trim().replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (!/^-?\d[\d.,]*$/.test(raw)) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => value.toFixed(6)))].map(Number);
}

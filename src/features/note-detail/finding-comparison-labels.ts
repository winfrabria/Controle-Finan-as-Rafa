import type { NoteDetailFinding } from "./data";

export type FindingComparisonLabels = {
  actual: string;
  expected: string;
};

const DEFAULT_LABELS: FindingComparisonLabels = {
  actual: "Encontrado",
  expected: "Esperado",
};

const CONTRACT_ITEM_LABELS: FindingComparisonLabels = {
  actual: "Item encontrado na nota",
  expected: "Item previsto no contrato",
};

/**
 * Selects reviewer-facing comparison labels from the finding structure.
 * Contract item-presence checks benefit from concrete labels, while numeric,
 * monetary and temporal comparisons keep the generic expected/found language.
 */
export function findingComparisonLabels(
  finding: Pick<
    NoteDetailFinding,
    | "actualValue"
    | "affectedItem"
    | "category"
    | "code"
    | "evidence"
    | "expectedValue"
    | "rule"
    | "title"
  >,
): FindingComparisonLabels {
  const structure = normalizeStructure([
    finding.category,
    finding.code,
    finding.title,
    finding.rule?.code,
    finding.rule?.name,
    ...collectJsonKeys(finding.evidence),
    ...collectJsonKeys(finding.expectedValue),
    ...collectJsonKeys(finding.actualValue),
  ]);

  const isContractual = /\bcontrat/.test(structure);
  const concernsItem =
    Boolean(finding.affectedItem) ||
    /\b(item|itens|material|materiais|produto|produtos)\b/.test(structure);
  const comparesMeasuredValue =
    /\b(quantidade|quantitativo|valor|preco|percentual|total|data|emissao|vencimento|validade|periodo|prazo|volume|medicao|medido|executado|limite|tolerancia|amount|price|date|issued|due|quantity)\b/.test(
      structure,
    );

  return isContractual && concernsItem && !comparesMeasuredValue
    ? CONTRACT_ITEM_LABELS
    : DEFAULT_LABELS;
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

import type { HarnessInvoice } from "./contracts";
import { buildCrossLayerDateComparisons } from "./cross-layer-comparisons";

type Row = HarnessInvoice["items"][number];

function measureKey(row: Row) {
  const group = row.documentGroup?.trim().toLowerCase();
  if (!group || !row.sourceText || !Number.isSafeInteger(row.sourcePage) || (row.sourcePage ?? 0) < 1) return null;
  const values = [row.quantity, row.unitPrice, row.totalAmount].map(value => value === null ? NaN : Number(value));
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  return JSON.stringify([group, ...values]);
}

/** Attention routing, not identity proof, hierarchy repair or a financial finding.
 * Exact measures only suggest comparing two uniquely paired, explicitly typed
 * sources. Unknown groups and many-to-many collisions never become guessed links. */
export function buildSourceComparisons(invoice: HarnessInvoice) {
  const groups = new Map<string, { fiscal: Row[]; control: Row[] }>();
  for (const row of invoice.items) {
    if (row.sourceKind !== "FISCAL_LINE" && row.sourceKind !== "SHEET") continue;
    const key = measureKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? { fiscal: [], control: [] };
    group[row.sourceKind === "FISCAL_LINE" ? "fiscal" : "control"].push(row);
    groups.set(key, group);
  }
  let ambiguousMeasureGroups = 0;
  const candidates = [...groups.values()].flatMap(group => {
    if (!group.fiscal.length || !group.control.length) return [];
    if (group.fiscal.length !== 1 || group.control.length !== 1) { ambiguousMeasureGroups += 1; return []; }
    const [fiscal, control] = [group.fiscal[0], group.control[0]];
    return [{ key: `source-pair:${fiscal.lineNumber}:${control.lineNumber}`,
      lineNumbers: [fiscal.lineNumber, control.lineNumber], pages: [fiscal.sourcePage!, control.sourcePage!],
      basis: "IDENTICAL_MEASURES_IN_SAME_GROUP" as const, relationship: "UNCONFIRMED" as const }];
  });
  return { candidates: [...candidates, ...buildCrossLayerDateComparisons(invoice)], ambiguousMeasureGroups };
}

/** Omit only null-valued object fields in the verification transport. Empty
 * arrays, false, zero, every row, quote and the complete markdown are retained.
 * The stored invoice and server-owned check identities are never changed. */
export function compactVerificationInvoice(invoice: HarnessInvoice) {
  const compact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(compact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== null && entry !== undefined).map(([key, entry]) => [key, compact(entry)]));
    return value;
  };
  return compact(invoice);
}

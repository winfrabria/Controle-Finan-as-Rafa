import type { HarnessInvoice } from "./contracts";
import { untracedObservationClaim } from "@/lib/integrations/openrouter/source-value-consistency";

type Item = HarnessInvoice["items"][number];

function explicitDiscountItem(item: Item) {
  const label = item.description?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() ?? "";
  const page = item.sourcePage;
  if (!/^(?:\(?-\)?\s*)?(?:descontos?|abatimentos?|discounts?)\b/u.test(label) ||
    item.totalAmount === null || Number(item.totalAmount) <= 0 || page == null || !item.sourceText ||
    untracedObservationClaim({ amount: item.totalAmount, date: null, text: item.sourceText })) return null;
  return { kind: "DISCOUNT" as const, amountScope: "ADJUSTMENT" as const,
    documentGroup: item.documentGroup ?? null, label: item.description, amount: item.totalAmount,
    date: null, page, text: item.sourceText };
}

/** Flat OCR can attach BOTH summaries and their daily supporting rows to the
 * invoice. They are alternative breakdown views, not additional expenses.
 * Resolve only uniquely identified unit-price/quantity schedules on the same
 * sheet. Equal grand totals alone never establish this relationship. */
function nonOverlappingChildren(children: Item[]): Item[] | null {
  const summaries = children.filter(item => item.documentRole === "SUMMARY");
  const details = children.filter(item => item.documentRole === "SUPPORTING_DOCUMENT");
  if (!summaries.length || !details.length) return children;
  if (summaries.length + details.length !== children.length) return null;
  const valid = (item: Item) => item.arithmeticVerified === true && item.sourceKind === "SHEET" &&
    item.sourcePage != null && Boolean(item.sourceText?.trim()) && item.quantity != null && item.unitPrice != null &&
    item.totalAmount != null && Number(item.quantity) > 0 && Number(item.unitPrice) > 0 &&
    !untracedObservationClaim({ amount: item.totalAmount ?? null, date: null, text: item.sourceText ?? null }) &&
    Math.abs(Number(item.quantity) * Number(item.unitPrice) - Number(item.totalAmount)) <= 0.01;
  if (!children.every(valid)) return null;
  const assigned = new Map<Item, Item[]>();
  for (const detail of details) {
    const candidates = summaries.filter(summary => summary.sourcePage === detail.sourcePage &&
      summary.documentGroup === detail.documentGroup && summary.unit === detail.unit &&
      Math.abs(Number(summary.unitPrice) - Number(detail.unitPrice)) < 0.00001);
    if (candidates.length !== 1) return null;
    const target = candidates[0];
    assigned.set(target, [...(assigned.get(target) ?? []), detail]);
  }
  for (const [summary, rows] of assigned) {
    if (Math.abs(rows.reduce((sum, row) => sum + Number(row.quantity), 0) - Number(summary.quantity)) > 0.00001 ||
      Math.abs(rows.reduce((sum, row) => sum + Number(row.totalAmount), 0) - Number(summary.totalAmount)) > 0.01) return null;
  }
  return summaries;
}

/** A relationship is documentary data, never inferred merely from matching sums. */
export function documentHierarchyIssue(items: Item[]) {
  const byLine = new Map(items.map((item) => [item.lineNumber, item]));
  for (const item of items) {
    const visited = new Set<number>([item.lineNumber]);
    let current = item;
    while (current.parentLineNumber != null) {
      const parent = byLine.get(current.parentLineNumber);
      if (!parent || visited.has(parent.lineNumber)) {
        return { reason: "invalid-parent-or-cycle", lineNumber: item.lineNumber };
      }
      if (item.countsTowardDocumentTotal && parent.countsTowardDocumentTotal) {
        return { reason: "overlapping-economic-layers", lineNumber: item.lineNumber };
      }
      visited.add(parent.lineNumber);
      current = parent;
    }
    if (item.breakdownComplete && !items.some((child) => child.parentLineNumber === item.lineNumber)) {
      return { reason: "complete-breakdown-without-children", lineNumber: item.lineNumber };
    }
    if (item.breakdownComplete && !nonOverlappingChildren(items.filter(child => child.parentLineNumber === item.lineNumber))) {
      return { reason: "ambiguous-overlapping-breakdown", lineNumber: item.lineNumber };
    }
  }
  return null;
}

export function completeDocumentBreakdowns(items: Item[]) {
  if (documentHierarchyIssue(items)) return [];
  return items.filter((item) => item.breakdownComplete === true).flatMap((parent) => {
    const resolvedChildren = nonOverlappingChildren(items.filter((child) => child.parentLineNumber === parent.lineNumber))!;
    const inferredDiscounts = new Map(resolvedChildren.flatMap(child => {
      const observation = explicitDiscountItem(child);
      return observation ? [[child.lineNumber, observation] as const] : [];
    }));
    const children = resolvedChildren.filter(child => !inferredDiscounts.has(child.lineNumber));
    // A discount attached to a product row is an adjustment, not proof that the
    // product itself is a complete subtotal with a one-line breakdown.
    if (!children.length) return [];
    const seen = new Set<string>();
    const discounts = [parent, ...resolvedChildren].flatMap(owner => (owner.evidenceObservations ?? []).flatMap(observation => {
      if (observation.kind !== "DISCOUNT" || observation.amount === null || Number(observation.amount) <= 0 ||
        (observation.amountScope !== undefined && observation.amountScope !== "ADJUSTMENT") ||
        observation.page === null || !observation.text ||
        untracedObservationClaim({ amount: observation.amount, date: null, text: observation.text })) return [];
      if (observation.documentGroup && observation.documentGroup !== parent.documentGroup &&
        observation.documentGroup !== owner.documentGroup) return [];
      const identity = JSON.stringify([observation.documentGroup, observation.page, Number(observation.amount), observation.text]);
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [{ observation, ownerLineNumber: owner.lineNumber }];
    })).concat([...inferredDiscounts].flatMap(([ownerLineNumber, observation]) => {
      const identity = JSON.stringify([observation.documentGroup, observation.page, Number(observation.amount), observation.text]);
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [{ observation, ownerLineNumber }];
    }));
    return [{ parent,
      // Only immediate children: a monthly subtotal and its daily rows are not added twice.
      children, discounts }];
  });
}

/** An omitted relationship must cause uncertainty, not a silent clean audit. */
export function ambiguousDocumentGroup(items: Item[]) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.documentGroup?.trim().toLowerCase();
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const [documentGroup, group] of groups) {
    if (group.some((item) => item.documentRole === "SUMMARY" || item.documentRole === "AGGREGATE_PAYMENT")) continue;
    if (group.filter((item) => item.countsTowardDocumentTotal === true).length !== 1) continue;
    const selectedLine = group.find((item) => item.countsTowardDocumentTotal === true)!.lineNumber;
    const byLine = new Map(group.map((item) => [item.lineNumber, item]));
    const linkedToSelected = (item: Item) => {
      const visited = new Set<number>();
      let current: Item | undefined = item;
      while (current && !visited.has(current.lineNumber)) {
        if (current.lineNumber === selectedLine) return true;
        visited.add(current.lineNumber);
        current = current.parentLineNumber == null ? undefined : byLine.get(current.parentLineNumber);
      }
      return false;
    };
    if (group.every(linkedToSelected)) continue;
    const repeatedKinds = new Map<string, Set<number>>();
    for (const item of group) {
      for (const observation of item.evidenceObservations ?? []) {
        if (observation.kind === "DISCOUNT" || observation.kind === "OTHER") continue;
        const lines = repeatedKinds.get(observation.kind) ?? new Set<number>();
        lines.add(item.lineNumber);
        repeatedKinds.set(observation.kind, lines);
      }
    }
    if (repeatedKinds.size >= 2 && [...repeatedKinds.values()].some((lines) => lines.size > 1)) {
      return { documentGroup, lineNumbers: group.map((item) => item.lineNumber) };
    }
  }
  return null;
}

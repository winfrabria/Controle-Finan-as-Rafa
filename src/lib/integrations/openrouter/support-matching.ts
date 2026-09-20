import type { InvoiceExtraction } from "./extraction-contract";

type Item = InvoiceExtraction["items"][number];
type Observation = Item["evidenceObservations"][number];

const SUPPORT_SOURCE_KINDS = new Set([
  "FISCAL_LINE",
  "RECEIPT",
  "SALE",
  "PAYMENT",
  "CHARGE",
]);

function normalizedGroup(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR") || null;
}

function cents(value: string | null | undefined) {
  if (value == null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const result = BigInt(whole + fraction.padEnd(2, "0"));
  return `${negative ? "-" : ""}${result}`;
}

function words(value: string | null | undefined) {
  const ignored = new Set(["alimentacao", "comprovante", "consumo", "documento", "ferramentas",
    "impressao", "item", "lanche", "material", "recibo", "servico", "total", "valor", "venda"]);
  return new Set((value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)?.filter(word => /\p{L}/u.test(word) && word.length >= 3 && !ignored.has(word)) ?? []);
}

function located(page: number | null | undefined, text: string | null | undefined) {
  return Number.isSafeInteger(page) && (page ?? 0) > 0 && Boolean(text?.trim());
}

export function economicSupportReference(item: Item) {
  const identity = item.code?.trim() || `item ${item.lineNumber}`;
  return `${identity} · ${item.description.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

function meaningfulIdentityOverlap(item: Item, texts: string[]) {
  const itemWords = words(`${item.description} ${item.sourceText ?? ""}`);
  const candidateText = texts.join(" ");
  const candidateWords = words(candidateText);
  let overlap = 0;
  for (const word of itemWords) if (candidateWords.has(word)) overlap++;
  if (overlap >= 2) return true;
  // OCR commonly splits or joins a trade name (PITDOG / PIT DOG). With the
  // amount/date gates applied by the caller, a distinctive six-letter token
  // contained in the other normalized excerpt is useful identity evidence.
  const candidateCompact = candidateText.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if ([...itemWords].some(word => word.length >= 6 && candidateCompact.includes(word))) return true;

  // OCR and cadastros frequentemente inserem/removem um termo curto no nome
  // fantasia (ex.: ALTYINFORMATICA / ALTYCEL INFORMATICA). Compare somente
  // nomes longos com o mesmo prefixo distintivo; valor exato e unicidade ainda
  // são exigidos pelo chamador antes de aceitar o vínculo.
  const distance = (left: string, right: string) => {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
      const current = [i];
      for (let j = 1; j <= right.length; j++) current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
  };
  const compactCandidates = (values: Set<string>) => {
    const tokens = [...values];
    return tokens.flatMap((_, index) => [1, 2, 3].flatMap(size =>
      index + size <= tokens.length ? [tokens.slice(index, index + size).join("")] : []));
  };
  return compactCandidates(itemWords).some(left => compactCandidates(candidateWords).some(right => {
    if (Math.min(left.length, right.length) < 8 || left.slice(0, 4) !== right.slice(0, 4)) return false;
    return distance(left, right) <= Math.max(2, Math.floor(Math.max(left.length, right.length) * 0.22));
  }));
}

type SupportGroup = {
  amounts: Set<string>;
  dates: Set<string>;
  fiscalAmounts: string[];
  id: string;
  texts: string[];
};

function addObservation(group: SupportGroup, source: Observation) {
  if (!located(source.page, source.text) || !SUPPORT_SOURCE_KINDS.has(source.kind)) return;
  const amount = cents(source.amount);
  if (amount !== null) group.amounts.add(amount);
  if (source.date) group.dates.add(source.date);
  group.texts.push(source.text!);
}

/**
 * Resolve only strong, document-local support relationships. Existing grouping
 * is not trusted on its own: it still needs a matching amount, or a matching
 * date plus a meaningful establishment identity. Cross-group candidates need
 * an exact amount and either an exact date or two contextual identity tokens.
 * Ambiguous many-to-many matches are deliberately left unresolved.
 */
export function matchedEconomicSupportLines(
  invoice: Pick<InvoiceExtraction, "items" | "documentObservations">,
) {
  const economicItems = invoice.items.filter(item => item.countsTowardDocumentTotal === true);
  const supported = new Set<number>();
  const groups = new Map<string, SupportGroup>();
  const groupFor = (id: string) => {
    const existing = groups.get(id);
    if (existing) return existing;
    const created: SupportGroup = { amounts: new Set(), dates: new Set(), fiscalAmounts: [], id, texts: [] };
    groups.set(id, created);
    return created;
  };

  for (const item of economicItems) {
    if (item.evidenceObservations.some(source => source.kind !== "SHEET" && source.kind !== "OTHER" &&
      source.kind !== "DISCOUNT" && located(source.page, source.text))) supported.add(item.lineNumber);
  }

  for (const item of invoice.items.filter(item => item.countsTowardDocumentTotal !== true && item.sourceKind &&
    SUPPORT_SOURCE_KINDS.has(item.sourceKind) && located(item.sourcePage, item.sourceText))) {
    const id = normalizedGroup(item.documentGroup) ?? `item:${item.lineNumber}`;
    const group = groupFor(id);
    const amount = cents(item.totalAmount);
    if (amount !== null) {
      // A fiscal product is a component, not an alternative receipt total.
      // Its complete group sum is eligible; the individual price is not.
      if (item.sourceKind === "FISCAL_LINE") group.fiscalAmounts.push(amount);
      else group.amounts.add(amount);
    }
    if (item.sourceDate) group.dates.add(item.sourceDate);
    group.texts.push(`${item.description} ${item.sourceText ?? ""}`);
    for (const source of item.evidenceObservations) addObservation(group, source);
  }

  for (const [index, source] of (invoice.documentObservations ?? []).entries()) {
    if (!located(source.page, source.text) || !SUPPORT_SOURCE_KINDS.has(source.kind)) continue;
    addObservation(groupFor(normalizedGroup(source.documentGroup) ?? `observation:${index + 1}`), source);
  }

  for (const group of groups.values()) {
    if (group.fiscalAmounts.length > 0) {
      const sum = group.fiscalAmounts.reduce((total, amount) => total + BigInt(amount), BigInt(0));
      group.amounts.add(String(sum));
    }
  }

  const candidates = new Map<number, SupportGroup[]>();
  for (const item of economicItems.filter(item => !supported.has(item.lineNumber))) {
    const amount = cents(item.totalAmount);
    if (amount === null) continue;
    const ownGroup = normalizedGroup(item.documentGroup);
    const scored = [...groups.values()].flatMap(group => {
      const amountMatches = group.amounts.has(amount);
      const dateMatches = Boolean(item.sourceDate && group.dates.has(item.sourceDate));
      const identityMatches = meaningfulIdentityOverlap(item, group.texts);
      const score = ownGroup === group.id
        ? amountMatches ? 4 : dateMatches && identityMatches ? 3 : 0
        : amountMatches && dateMatches && identityMatches ? 3
          : amountMatches && (dateMatches || identityMatches) ? 2 : 0;
      return score > 0 ? [{ group, score }] : [];
    });
    const bestScore = Math.max(0, ...scored.map(match => match.score));
    const matches = scored.filter(match => match.score === bestScore).map(match => match.group);
    if (matches.length > 0) candidates.set(item.lineNumber, matches);
  }

  const groupDegrees = new Map<string, number>();
  for (const matches of candidates.values()) for (const group of matches) {
    groupDegrees.set(group.id, (groupDegrees.get(group.id) ?? 0) + 1);
  }
  for (const [lineNumber, matches] of candidates) {
    if (matches.length === 1 && groupDegrees.get(matches[0].id) === 1) supported.add(lineNumber);
  }
  return supported;
}

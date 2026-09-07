export type FindingEvidenceObservation = {
  amount: string | number | null;
  date: string | null;
  kind: "SHEET" | "RECEIPT" | "SALE" | "PAYMENT" | "DISCOUNT" | "OTHER";
  label: string | null;
  page: number | null;
  text: string | null;
};

export type FindingEvidenceObservationSummary = FindingEvidenceObservation & {
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  totalAmount: number | null;
};

const observationKindLabels: Record<
  FindingEvidenceObservation["kind"],
  string
> = {
  SHEET: "Ficha",
  RECEIPT: "Recibo",
  SALE: "Venda ou pedido",
  PAYMENT: "Pagamento",
  DISCOUNT: "Desconto",
  OTHER: "Outro registro",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function findingEvidenceField(value: unknown) {
  if (!isRecord(value)) return null;
  const field = value.field ?? value.fieldName;
  return typeof field === "string" ? field : null;
}

export function extractFindingEvidenceObservations(
  value: unknown,
): FindingEvidenceObservation[] {
  if (!isRecord(value) || !Array.isArray(value.observations)) return [];

  return value.observations.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const rawKind =
      typeof entry.kind === "string" ? entry.kind.toUpperCase() : "OTHER";
    const kind = [
      "SHEET",
      "RECEIPT",
      "SALE",
      "PAYMENT",
      "DISCOUNT",
      "OTHER",
    ].includes(rawKind)
      ? (rawKind as FindingEvidenceObservation["kind"])
      : "OTHER";

    return [
      {
        amount:
          typeof entry.amount === "string" || typeof entry.amount === "number"
            ? entry.amount
            : null,
        date: typeof entry.date === "string" ? entry.date : null,
        kind,
        label: typeof entry.label === "string" ? entry.label : null,
        page: typeof entry.page === "number" ? entry.page : null,
        text: typeof entry.text === "string" ? entry.text : null,
      },
    ];
  });
}

export function findingObservationKindLabel(
  kind: FindingEvidenceObservation["kind"],
) {
  return observationKindLabels[kind];
}

/**
 * Collapses repeated rows from the same visible source (for example, a daily
 * meal control) without losing their count, date range or monetary total.
 * Different document kinds, pages and labels always remain separate.
 */
export function summarizeFindingEvidenceObservations(
  observations: FindingEvidenceObservation[],
): FindingEvidenceObservationSummary[] {
  const groups = new Map<string, FindingEvidenceObservation[]>();

  for (const [index, observation] of observations.entries()) {
    const identity = normalizeReviewerText(
      observation.label ?? observation.text ?? `registro-${index}`,
    );
    const key = [observation.kind, observation.page ?? "", identity].join(":");
    const entries = groups.get(key) ?? [];
    entries.push(observation);
    groups.set(key, entries);
  }

  return [...groups.values()].map((entries) => {
    const first = entries[0];
    const dates = entries
      .map((entry) => entry.date)
      .filter((date): date is string => Boolean(date))
      .sort();
    const amounts = entries
      .map((entry) =>
        entry.amount === null ? null : Number(entry.amount),
      )
      .filter((amount): amount is number => Number.isFinite(amount));

    return {
      ...first,
      amount: entries.length === 1 ? first.amount : null,
      count: entries.length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      text: entries.length === 1 ? first.text : null,
      totalAmount:
        entries.length > 1 && amounts.length === entries.length
          ? amounts.reduce((total, amount) => total + amount, 0)
          : null,
    };
  });
}

export function formatFindingObservationDate(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function formatFindingObservationAmount(
  value: string | number | null,
) {
  if (value === null) return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("pt-BR", {
        currency: "BRL",
        style: "currency",
      }).format(amount)
    : String(value);
}

export function reviewerTextIsDistinct(
  candidate: string | null | undefined,
  comparedWith: Array<string | null | undefined>,
) {
  const normalizedCandidate = normalizeReviewerText(candidate);
  if (!normalizedCandidate) return false;

  return comparedWith.every((value) => {
    const normalizedValue = normalizeReviewerText(value);
    if (!normalizedValue) return true;
    return !(
      normalizedCandidate === normalizedValue ||
      normalizedCandidate.includes(normalizedValue) ||
      normalizedValue.includes(normalizedCandidate)
    );
  });
}

function normalizeReviewerText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

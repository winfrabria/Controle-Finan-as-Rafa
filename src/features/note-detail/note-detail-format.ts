import type { Prisma } from "@/generated/prisma/client";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatCurrency(value: string | null) {
  if (!value) return "Não identificado";
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? currencyFormatter.format(parsed)
    : "Não identificado";
}

export function formatDecimal(value: string | null, digits = 2) {
  if (!value) return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("pt-BR", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : value;
}

export function formatDate(value: Date | null) {
  return value ? dateFormatter.format(value) : "Não identificada";
}

export function formatDateTime(value: Date) {
  return dateTimeFormatter.format(value);
}

export function jsonSummary(
  value: Prisma.JsonValue | null,
  fallback = "Não informado",
): string {
  if (value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const entries: string[] = value
      .map((item) => jsonSummary(item, ""))
      .filter(Boolean);
    return entries.length ? entries.join(", ") : fallback;
  }

  const preferredKeys = [
    "descricao",
    "description",
    "item",
    "itemNota",
    "referencia",
    "reference",
    "valor",
    "value",
    "motivo",
    "reason",
  ];
  for (const key of preferredKeys) {
    if (key in value) {
      const summarized = jsonSummary(value[key] ?? null, "");
      if (summarized) return summarized;
    }
  }

  const entries: string[] = Object.entries(value)
    .slice(0, 3)
    .map(([key, entry]) => `${humanizeKey(key)}: ${jsonSummary(entry ?? null, "—")}`);
  return entries.length ? entries.join(" · ") : fallback;
}

export function humanizeKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function severityLabel(value: string) {
  if (value === "CRITICAL") return "Alta";
  if (value === "WARNING") return "Média";
  return "Informativa";
}

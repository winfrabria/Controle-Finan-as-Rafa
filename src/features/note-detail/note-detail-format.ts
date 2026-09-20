import type { Prisma } from "@/generated/prisma/client";

import {
  formatFindingValue,
  humanizeFindingKey,
} from "@/features/internal-notes/finding-display";

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

// Quantities and unit prices are measurements, not two-decimal currency totals.
// Format the canonical decimal string without rounding or converting to Number.
function formatMeasuredDecimal(value: string | null, minimumFractionDigits: number) {
  if (!value?.trim()) return "—";
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return value;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(minimumFractionDigits, "0");
  const sign = match[1] && /[1-9]/.test(integer + fraction) ? "-" : "";
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fraction ? `,${fraction}` : ""}`;
}

export function formatQuantity(value: string | null) {
  return formatMeasuredDecimal(value, 0);
}

export function formatUnitPrice(value: string | null) {
  return formatMeasuredDecimal(value, 2);
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
  return formatFindingValue(value, fallback);
}

export function humanizeKey(value: string) {
  return humanizeFindingKey(value);
}

export function severityLabel(value: string) {
  if (value === "CRITICAL") return "Alta";
  if (value === "WARNING") return "Média";
  return "Informativa";
}

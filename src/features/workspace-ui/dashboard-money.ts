export function parseDashboardMoney(value: string) {
  const stripped = value.replace(/R\$\s?/gi, "").replace(/[^\d,.-]/g, "").trim();
  if (!stripped) return 0;

  const normalized = stripped.includes(",")
    ? stripped.replace(/\./g, "").replace(",", ".")
    : stripped;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

export function formatDashboardMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

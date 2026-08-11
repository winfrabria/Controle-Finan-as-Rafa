const LEGACY_RESPONSIBLE_NAMES: Record<string, string> = {
  nlado: "Naldo",
};

/**
 * Keeps known legacy spelling mistakes out of the interface while the data
 * correction migration is waiting to be applied.
 */
export function normalizeResponsibleName(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  return LEGACY_RESPONSIBLE_NAMES[normalized.toLocaleLowerCase("pt-BR")] ?? normalized;
}

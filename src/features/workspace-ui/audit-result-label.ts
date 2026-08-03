export type AuditResultLabel =
  | "Em análise"
  | "Falha de leitura"
  | "Falha de processamento"
  | "OK"
  | "Precisa de informação"
  | "Suspeita";

export function auditResultLabel(
  auditResult: string | null | undefined,
  legacyClassification: string | null | undefined,
  noteStatus?: string | null,
): AuditResultLabel {
  if (auditResult === "OK") return "OK";
  if (auditResult === "SUSPICIOUS") return "Suspeita";
  if (auditResult === "NEEDS_CONTEXT") return "Precisa de informação";
  if (auditResult === "READ_FAILED") return "Falha de leitura";

  if (noteStatus === "READ_FAILED") return "Falha de leitura";
  if (noteStatus === "FAILED") return "Falha de processamento";

  if (legacyClassification === "OK") return "OK";
  if (legacyClassification === "SUSPICIOUS") return "Suspeita";
  if (legacyClassification === "NO_PARAMETER") return "Precisa de informação";
  if (legacyClassification === "INCOMPATIBLE") return "Falha de leitura";
  return "Em análise";
}

export function auditResultTone(label: AuditResultLabel) {
  if (label === "OK") return "ok" as const;
  if (label === "Falha de leitura" || label === "Falha de processamento") {
    return "danger" as const;
  }
  if (label === "Precisa de informação" || label === "Em análise") {
    return "info" as const;
  }
  return "warning" as const;
}

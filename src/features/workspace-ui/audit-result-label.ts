export type AuditResultLabel =
  | "Revisão manual"
  | "Em análise"
  | "Falha de leitura"
  | "Falha de processamento"
  | "Informação insuficiente"
  | "OK"
  | "Precisa de informação"
  | "Suspeita";

export function auditResultLabel(
  auditResult: string | null | undefined,
  legacyClassification: string | null | undefined,
  noteStatus?: string | null,
  findingCount = 0,
): AuditResultLabel {
  if (auditResult === "READ_FAILED" || noteStatus === "READ_FAILED") {
    return "Falha de leitura";
  }
  if (noteStatus === "FAILED") return "Falha de processamento";
  if (findingCount > 0) return "Suspeita";
  if (auditResult === "OK") return "OK";
  if (auditResult === "SUSPICIOUS") return "Suspeita";
  // Legacy terminal coverage gaps share NEEDS_CONTEXT + NO_PARAMETER. They are
  // not active user questions and, critically, are not proof of an OK audit.
  if (auditResult === "NEEDS_CONTEXT") {
    return legacyClassification === "NO_PARAMETER" ? "Falha de leitura" : "Precisa de informação";
  }
  if (legacyClassification === "NO_PARAMETER") return "Falha de leitura";

  if (legacyClassification === "OK") return "OK";
  if (legacyClassification === "SUSPICIOUS") return "Suspeita";
  if (legacyClassification === "INCOMPATIBLE") return "Falha de leitura";
  return "Em análise";
}

export function auditResultTone(label: AuditResultLabel) {
  if (label === "OK") return "ok" as const;
  if (label === "Falha de leitura" || label === "Falha de processamento") {
    return "danger" as const;
  }
  if (
    label === "Revisão manual" ||
    label === "Informação insuficiente" ||
    label === "Precisa de informação" ||
    label === "Em análise"
  ) {
    return "info" as const;
  }
  return "warning" as const;
}

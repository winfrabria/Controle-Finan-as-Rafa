/** Public copy is selected by safe codes, never by raw provider error text. */
export function analysisFailureMessage(status: string, code?: string | null) {
  if (status !== "FAILED") return null;
  if (code === "EXTRACTION_TIMEOUT" || code === "AUDIT_TIMEOUT" || code === "VERIFICATION_TIMEOUT") {
    return "A análise não terminou dentro do prazo. Isso é uma falha de processamento, não uma irregularidade nem ausência de dados no documento. O arquivo original continua disponível; solicite ao administrador uma nova tentativa.";
  }
  return "Não foi possível concluir o processamento. Ainda não há diagnóstico válido desta tentativa. O arquivo original continua disponível para conferência; solicite ao administrador a revisão da falha.";
}

/** The caller supplies reviewer-safe assurance text, never provider errors. */
export function unavailableDiagnosisCopy(status: string | null, limitationReason?: string | null) {
  if (status === "Aguardando processamento" || status === "Em análise") {
    return {
      description: "O anexo ainda está na fila de análise. O diagnóstico será exibido quando o processamento terminar.",
      title: "Análise ainda não concluída",
    };
  }
  if (status === "Não processado") {
    return {
      description: "Este anexo antigo não possui uma execução de processamento associada.",
      title: "Análise não iniciada",
    };
  }
  if (status === "Falha de leitura") {
    return {
      description: "A leitura automática não reuniu cobertura confiável do documento inteiro para gerar um diagnóstico. O arquivo original continua disponível para conferência.",
      title: "Não foi possível ler o anexo",
    };
  }
  if (status === "Falha de processamento") {
    return {
      description: "A leitura foi iniciada, mas o processamento não chegou a um diagnóstico final.",
      title: "O processamento não foi concluído",
    };
  }
  if (status === "Análise incompleta" || status === "Informação insuficiente" || status === "Revisão manual") {
    return {
      description: limitationReason?.trim() || "A leitura automática não reuniu evidência suficiente para classificar este anexo com segurança. Isso não comprova uma irregularidade no documento.",
      title: "Revisão manual necessária",
    };
  }
  return null;
}

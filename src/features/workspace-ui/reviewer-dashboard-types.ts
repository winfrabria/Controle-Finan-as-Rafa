export type ReviewerDashboardNote = {
  classification:
    | "Aguardando processamento"
    | "Em análise"
    | "Falha de leitura"
    | "Falha de processamento"
    | "Não processado"
    | "OK"
    | "Precisa de informação"
    | "Sem parâmetro"
    | "Suspeita";
  date: string;
  dateKey: string;
  id: string;
  number: string;
  reasons: string[];
  responsible: string;
  supplier: string;
  value: string;
  work: string;
  workId: string;
};

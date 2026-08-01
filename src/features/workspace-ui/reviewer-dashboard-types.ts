export type ReviewerDashboardNote = {
  classification:
    | "Aguardando processamento"
    | "Em análise"
    | "Falha de leitura"
    | "Falha de processamento"
    | "OK"
    | "Sem parâmetro"
    | "Suspeita";
  date: string;
  dateKey: string;
  id: string;
  number: string;
  reasons: string[];
  supplier: string;
  value: string;
  work: string;
};

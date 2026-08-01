export type NoteFindingVisual = {
  actualValue?: string | null;
  category?: string | null;
  description: string;
  evidence?: string | null;
  expectedValue?: string | null;
  justification?: string | null;
  severity?: string | null;
  title: string;
};

export type NoteVisualItem = {
  classification: string;
  date: string;
  finding?: string;
  findings?: NoteFindingVisual[];
  id: string;
  number: string;
  supplier: string;
  value: string;
  version: number;
  work?: string;
};

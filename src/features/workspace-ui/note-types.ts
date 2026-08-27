export type NoteFindingVisual = {
  actualValue?: string | null;
  category?: string | null;
  code?: string | null;
  description: string;
  evidence?: string | null;
  evidenceDetails?: { label: string; value: string }[];
  evidenceLocations?: Array<{
    amount?: string | null;
    date?: string | null;
    kind: string;
    label?: string | null;
    page?: number | null;
    text?: string | null;
  }>;
  expectedValue?: string | null;
  justification?: string | null;
  severity?: string | null;
  title: string;
};

export type NoteVisualItem = {
  activeContextQuestionCount?: number;
  classification: string;
  date: string;
  finding?: string;
  findingCount?: number;
  findings?: NoteFindingVisual[];
  id: string;
  isRead?: boolean;
  number: string;
  responsible?: string;
  readAt?: string;
  readAtLabel?: string;
  readBy?: string;
  supplier: string;
  value: string;
  version: number;
  work?: string;
};

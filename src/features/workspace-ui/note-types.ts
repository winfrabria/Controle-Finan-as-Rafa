export type NoteFindingVisual = {
  actualValue?: string | null;
  category?: string | null;
  description: string;
  evidence?: string | null;
  evidenceDetails?: { label: string; value: string }[];
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

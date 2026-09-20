export type NoteFindingVisual = {
  actualValue?: string | null;
  category?: string | null;
  code?: string | null;
  comparisonMode?: "REFERENCE" | "CONFLICT" | null;
  description: string;
  evidence?: string | null;
  evidenceDetails?: { label: string; value: string }[];
  evidenceLocations?: Array<{
    value?: string | null;
    amount?: string | null;
    date?: string | null;
    kind: string;
    label?: string | null;
    page?: number | null;
    text?: string | null;
  }>;
  expectedValue?: string | null;
  justification?: string | null;
  referenceBasis?: string | null;
  requiresSourceReview?: boolean;
  severity?: string | null;
  title: string;
};

export type NoteVisualItem = {
  activeContextQuestionCount?: number;
  assurance?: { band: "HIGH" | "MEDIUM" | "LIMITED"; reason: string } | null;
  classification: string;
  date: string;
  processingFailureMessage?: string | null;
  finding?: string;
  findingCount?: number;
  findings?: NoteFindingVisual[];
  id: string;
  isRead?: boolean;
  issuedAtLabel?: string;
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

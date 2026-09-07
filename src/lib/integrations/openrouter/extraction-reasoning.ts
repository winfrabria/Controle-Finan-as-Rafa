export const EXTRACTION_REASONING_EFFORTS = [
  "none", "minimal", "low", "medium", "high", "xhigh", "max",
] as const;
export type ExtractionReasoningEffort = typeof EXTRACTION_REASONING_EFFORTS[number];

export function resolveExtractionReasoningEffort(
  value: string | undefined,
  fallback: ExtractionReasoningEffort,
  name: string,
): ExtractionReasoningEffort {
  const effort = value?.trim() || fallback;
  if (!EXTRACTION_REASONING_EFFORTS.includes(effort as ExtractionReasoningEffort)) {
    throw new Error(`${name} must be none, minimal, low, medium, high, xhigh or max.`);
  }
  return effort as ExtractionReasoningEffort;
}

/** The existing database enum predates adaptive extraction. JSON is authoritative
 * for extraction; the compatibility column must never drive the provider call. */
export function extractionReasoningStorage(effort: ExtractionReasoningEffort) {
  return effort === "max" ? "MAX" : effort === "xhigh" ? "XHIGH" : "HIGH";
}

export function effectiveRunReasoning(run: {
  reasoningEffort: string;
  kind?: string;
  structuredResponse?: unknown;
}) {
  const data = run.structuredResponse;
  if (run.kind === "EXTRACTION" && data && typeof data === "object" &&
      "extractionReasoningEffort" in data &&
      EXTRACTION_REASONING_EFFORTS.includes(data.extractionReasoningEffort as ExtractionReasoningEffort)) {
    return String(data.extractionReasoningEffort).toUpperCase();
  }
  return run.reasoningEffort;
}

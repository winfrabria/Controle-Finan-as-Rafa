export type CostCoverage = "KNOWN" | "PARTIAL" | "UNKNOWN";

/** Missing provider billing metadata is never equivalent to a free request. */
export function costCoverage(attempts: readonly { usage?: { costUsd?: number } }[], costUsd?: number): CostCoverage {
  if (attempts.length === 0) return costUsd === undefined ? "UNKNOWN" : "KNOWN";
  const known = attempts.filter((attempt) => attempt.usage?.costUsd !== undefined).length;
  return known === attempts.length ? "KNOWN" : known > 0 || costUsd !== undefined ? "PARTIAL" : "UNKNOWN";
}

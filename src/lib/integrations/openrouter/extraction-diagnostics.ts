type SchemaIssue = { path: readonly PropertyKey[]; code: string; message: string };

/** Keep actionable schema locations, never provider text, JSON values or reasoning. */
export function extractionSchemaDiagnostics(issues: readonly SchemaIssue[]) {
  return {
    issues: issues.slice(0, 5).map((issue) => {
      const hierarchyReason = /^Invalid document hierarchy: (invalid-parent-or-cycle|overlapping-economic-layers|complete-breakdown-without-children)\.$/.exec(issue.message)?.[1];
      return { path: issue.path.map(String).join(".") || "root", code: issue.code,
        ...(hierarchyReason ? { reason: hierarchyReason } : {}) };
    }),
  };
}

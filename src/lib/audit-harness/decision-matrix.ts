import type {
  HarnessClassification,
  HarnessFinding,
} from "./contracts";
import { AUDIT_POLICY } from "./policy";

export type DecisionMatrixInput = {
  contextQuestions?: number;
  contextRequired?: boolean;
  readFailed: boolean;
  deterministicCoverage: boolean;
  aiCoverage: boolean;
  findings: HarnessFinding[];
};

export function isSupportedFinding(finding: HarnessFinding) {
  if (
    finding.confidence < AUDIT_POLICY.supportedFindingThreshold ||
    finding.justification.trim().length === 0 ||
    Object.keys(finding.evidence).length === 0
  ) {
    return false;
  }

  if (finding.source !== "AI_DISCOVERY") return true;

  const evidence = finding.evidence;
  const hasAffectedLocation =
    finding.noteItemLineNumber !== null ||
    (typeof evidence.field === "string" && evidence.field.trim().length > 0) ||
    (typeof evidence.item === "string" && evidence.item.trim().length > 0) ||
    typeof evidence.lineNumber === "number" ||
    typeof evidence.page === "number";
  const hasConcreteEvidence =
    (typeof evidence.summary === "string" && evidence.summary.trim().length > 0) ||
    (typeof evidence.quote === "string" && evidence.quote.trim().length > 0) ||
    (typeof evidence.source === "string" && evidence.source.trim().length > 0);

  return hasAffectedLocation && hasConcreteEvidence;
}

export function decideClassification(
  input: DecisionMatrixInput,
): HarnessClassification {
  if (input.readFailed) return "READ_FAILED";

  const supportedFinding = input.findings.some(isSupportedFinding);
  if (supportedFinding) return "SUSPICIOUS";

  if (
    input.contextRequired ||
    (input.contextQuestions ?? 0) > 0 ||
    (!input.deterministicCoverage && !input.aiCoverage)
  ) {
    return "NEEDS_CONTEXT";
  }

  return "OK";
}

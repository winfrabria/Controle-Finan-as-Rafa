import type {
  HarnessClassification,
  HarnessFinding,
} from "./contracts";
import { AUDIT_POLICY } from "./policy";

export type DecisionMatrixInput = {
  readFailed: boolean;
  deterministicCoverage: boolean;
  aiCoverage: boolean;
  findings: HarnessFinding[];
};

export function decideClassification(
  input: DecisionMatrixInput,
): HarnessClassification {
  if (input.readFailed) return "READ_FAILED";

  const supportedFinding = input.findings.some(
    (finding) =>
      finding.confidence >= AUDIT_POLICY.supportedFindingThreshold &&
      Object.keys(finding.evidence).length > 0 &&
      finding.justification.trim().length > 0,
  );
  if (supportedFinding) return "SUSPICIOUS";

  if (!input.deterministicCoverage && !input.aiCoverage) {
    return "NO_PARAMETER";
  }

  return "OK";
}


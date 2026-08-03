import type {
  AiDiscoveryResponse,
  DuplicateCandidate,
  HarnessInvoice,
  WorkRuleInput,
} from "./contracts";
import { decideClassification } from "./decision-matrix";
import { isReadFailure, selectReasoningEffort } from "./policy";
import { evaluateUniversalRules, evaluateWorkRules } from "./rules";
import { HARNESS_VERSIONS } from "./versions";

export function evaluateHarness(input: {
  invoice: HarnessInvoice;
  workRules?: WorkRuleInput[];
  duplicates?: DuplicateCandidate[];
  aiDiscovery?: AiDiscoveryResponse;
  now?: Date;
}) {
  const readFailed = isReadFailure(input.invoice);
  if (readFailed) {
    return {
      classification: "READ_FAILED" as const,
      contextQuestions: [],
      findings: [],
      coverage: { deterministic: false, ai: false, areas: [] as string[] },
      reasoning: { effort: "high" as const, triggers: [] as string[] },
      versions: HARNESS_VERSIONS,
    };
  }

  const universal = evaluateUniversalRules({
    invoice: input.invoice,
    duplicates: input.duplicates,
    now: input.now,
  });
  const work = evaluateWorkRules(input.invoice, input.workRules ?? []);
  const findings = [
    ...universal.findings,
    ...work.findings,
    ...(input.aiDiscovery?.findings ?? []),
  ];
  const deterministicCoverage = universal.covered || work.covered;
  const aiCoverage = input.aiDiscovery?.coverage.sufficientEvidence ?? false;
  const contextQuestions = input.aiDiscovery?.contextQuestions ?? [];
  const contextRequired = input.aiDiscovery?.needsContext ?? false;

  return {
    classification: decideClassification({
      contextQuestions: contextQuestions.length,
      contextRequired,
      readFailed: false,
      deterministicCoverage,
      aiCoverage,
      findings,
    }),
    findings,
    contextQuestions,
    coverage: {
      deterministic: deterministicCoverage,
      ai: aiCoverage,
      areas: [
        ...universal.coveredAreas,
        ...(input.aiDiscovery?.coverage.checkedAreas ?? []),
      ],
    },
    reasoning: selectReasoningEffort(input.invoice, findings),
    versions: HARNESS_VERSIONS,
  };
}

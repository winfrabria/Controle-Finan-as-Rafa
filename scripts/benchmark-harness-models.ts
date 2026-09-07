import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateUniversalRules,
  evaluateWorkRules,
  type HarnessInvoice,
} from "@/lib/audit-harness";
import {
  goldenCasesFileSchema,
  runGoldenCases,
  type GoldenCase,
} from "@/lib/audit-harness/evals";
import {
  AUDIT_BENCHMARK_MODEL_PROFILES,
  AUDIT_BENCHMARK_MODELS,
  AUDIT_EVALUATOR_MODELS,
  type AuditEvaluatorModel,
} from "@/lib/audit-harness/versions";
import { OpenRouterAuditDiscoveryClient } from "@/server/integrations/openrouter/audit-client";
import { getOpenRouterConfig } from "@/server/integrations/openrouter/config";

type Arguments = {
  online: boolean;
  plan: boolean;
  phase: "elimination" | "final";
  models: AuditEvaluatorModel[];
  caseIds: string[];
  casesPath: string;
  outputPath: string;
  repetitions: number;
};

function usage(): never {
  console.error(
    [
      "Uso: npm run evals:harness:online -- [opções]",
      "  --models <slug,slug>   modelos da allowlist",
      "  --case-ids <id,id>     casos do corpus",
      "  --cases <arquivo>      corpus versionado",
      "  --out <arquivo>        relatório JSON",
      "  --repetitions <1-5>    repetições sequenciais por caso",
      "  --phase <elimination|final> rodada do benchmark",
      "  --plan                 gera manifesto sem chamar provedor",
      "  --online               obrigatório; impede gasto acidental",
    ].join("\n"),
  );
  process.exit(2);
}

function parseCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  let online = false;
  let plan = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--online") {
      online = true;
      continue;
    }
    if (argument === "--plan") {
      plan = true;
      continue;
    }
    if (
      !["--models", "--case-ids", "--cases", "--out", "--repetitions", "--phase"].includes(
        argument,
      )
    ) {
      usage();
    }
    const value = argv[index + 1];
    if (!value) usage();
    values.set(argument, value);
    index += 1;
  }

  const requestedModels = parseCsv(values.get("--models"));
  const allowed = new Set<string>(AUDIT_EVALUATOR_MODELS);
  if (requestedModels.some((model) => !allowed.has(model))) {
    throw new Error(
      `Modelo fora da allowlist. Permitidos: ${AUDIT_EVALUATOR_MODELS.join(", ")}.`,
    );
  }

  if (online === plan) {
    throw new Error("Escolha exatamente um modo: --plan ou --online.");
  }
  const phase = values.get("--phase") ?? "elimination";
  if (phase !== "elimination" && phase !== "final") {
    throw new Error("--phase deve ser elimination ou final.");
  }
  const requestedCases = parseCsv(values.get("--case-ids"));
  const repetitions = Number.parseInt(
    values.get("--repetitions") ?? (phase === "final" ? "3" : "1"),
    10,
  );
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
    throw new Error("--repetitions deve ser um inteiro entre 1 e 5.");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    online,
    plan,
    phase,
    models: (requestedModels.length > 0
      ? requestedModels
      : [...AUDIT_BENCHMARK_MODELS]) as AuditEvaluatorModel[],
    caseIds: requestedCases,
    casesPath:
      values.get("--cases") ??
      "src/lib/audit-harness/evals/__fixtures__/golden-cases.v1.json",
    outputPath:
      values.get("--out") ??
      `.codex/benchmarks/harness-models-${stamp}.json`,
    repetitions,
  };
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

async function loadCases(casesPath: string, caseIds: string[]) {
  const raw = JSON.parse(await readFile(path.resolve(casesPath), "utf8")) as unknown;
  const parsed = goldenCasesFileSchema.parse(raw);
  const wanted = new Set(caseIds);
  const selected = caseIds.length === 0
    ? parsed.cases
    : parsed.cases.filter((goldenCase) => wanted.has(goldenCase.id));
  const missing = caseIds.filter(
    (id) => !selected.some((goldenCase) => goldenCase.id === id),
  );
  if (missing.length > 0) {
    throw new Error(`Casos não encontrados: ${missing.join(", ")}.`);
  }
  return selected;
}

async function evaluateModel(
  model: AuditEvaluatorModel,
  cases: GoldenCase[],
  repetitions: number,
) {
  const config = getOpenRouterConfig(
    {
      ...process.env,
      OPENROUTER_AUDIT_MODEL: model,
      OPENROUTER_AUDIT_REASONING_EFFORT: "high",
      OPENROUTER_MAX_ATTEMPTS: "2",
      OPENROUTER_WEB_SEARCH_ENABLED: "false",
    },
    "audit",
  );
  const client = new OpenRouterAuditDiscoveryClient({
    ...config,
    fallbackModel: model,
    fallbackReasoningEffort: "high",
  });

  const caseResults: Array<Record<string, unknown>> = [];
  for (const goldenCase of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const startedAt = Date.now();
      try {
        const invoice = goldenCase.input.invoice as HarnessInvoice;
        const universal = evaluateUniversalRules({
          invoice,
          duplicates: goldenCase.input.duplicates,
          now: new Date(`${goldenCase.input.now}T00:00:00.000Z`),
        });
        const work = evaluateWorkRules(invoice, goldenCase.input.workRules);
        const audit = await client.discover({
          deterministicFindings: [...universal.findings, ...work.findings],
          invoice,
          reasoningEffort: "high",
          workRules: goldenCase.input.workRules,
        });
        const replayCase: GoldenCase = {
          ...goldenCase,
          input: { ...goldenCase.input, aiDiscovery: audit.data },
        };
        const result = runGoldenCases([replayCase]).results[0];
        caseResults.push({
          id: goldenCase.id,
          repetition,
          passed: result.passed,
          classification: result.classification,
          findingCodes: result.findingCodes,
          contextQuestionCodes: result.contextQuestionCodes,
          failedChecks: result.checks
            .filter((check) => !check.passed)
            .map((check) => ({ name: check.name, details: check.details })),
          attempts: audit.attempts,
          providerModel: audit.model,
          latencyMs: audit.latencyMs,
          wallLatencyMs: Date.now() - startedAt,
          totalTokens: audit.usage?.totalTokens ?? null,
          costUsd: audit.usage?.costUsd ?? null,
        });
      } catch (error) {
        caseResults.push({
          id: goldenCase.id,
          repetition,
          passed: false,
          error: error instanceof Error ? error.message : "Falha desconhecida.",
          wallLatencyMs: Date.now() - startedAt,
        });
      }
    }
  }

  const successful = caseResults.filter((result) => !result.error);
  const latencies = successful
    .map((result) => result.latencyMs)
    .filter((value): value is number => typeof value === "number");
  const costs = successful
    .map((result) => result.costUsd)
    .filter((value): value is number => typeof value === "number");
  const tokens = successful
    .map((result) => result.totalTokens)
    .filter((value): value is number => typeof value === "number");

  return {
    model,
    reasoningEffort: "high",
    totals: {
      cases: caseResults.length,
      passed: caseResults.filter((result) => result.passed === true).length,
      failed: caseResults.filter((result) => result.passed !== true).length,
      providerErrors: caseResults.filter((result) => result.error).length,
    },
    metrics: {
      passRate: round(
        caseResults.filter((result) => result.passed === true).length /
          Math.max(caseResults.length, 1),
      ),
      latencyMsP50: percentile(latencies, 0.5),
      latencyMsP95: percentile(latencies, 0.95),
      totalTokens: tokens.reduce((sum, value) => sum + value, 0),
      totalCostUsd: round(costs.reduce((sum, value) => sum + value, 0)),
    },
    cases: caseResults,
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const cases = await loadCases(args.casesPath, args.caseIds);

  if (args.plan) {
    const report = {
      generatedAt: new Date().toISOString(),
      mode: "plan-no-provider-call",
      phase: args.phase,
      chargedProviderCalls: 0,
      configuration: {
        caseIds: cases.map((goldenCase) => goldenCase.id),
        models: args.models.map((model) => ({
          model,
          profile:
            model in AUDIT_BENCHMARK_MODEL_PROFILES
              ? AUDIT_BENCHMARK_MODEL_PROFILES[
                  model as keyof typeof AUDIT_BENCHMARK_MODEL_PROFILES
                ]
              : null,
        })),
        repetitions: args.repetitions,
        promotionRequirements: {
          criticalFalsePositives: 0,
          knownCaseRegressions: 0,
          structuredResponseRate: 0.99,
          qualityAtLeastTerra: true,
        },
      },
    };
    const outputPath = path.resolve(args.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[benchmark] plano sem chamadas pagas: ${outputPath}`);
    console.log(`[benchmark] ${args.models.length} modelos · ${cases.length} casos · ${args.repetitions} repetição(ões)`);
    return;
  }

  // Sequencial por desenho: concorrência entre provedores não pode distorcer
  // latência, retry e custo da comparação.
  const models = [];
  for (const model of args.models) {
    console.log(
      `[benchmark] ${model} — ${cases.length} caso(s) × ${args.repetitions}`,
    );
    models.push(await evaluateModel(model, cases, args.repetitions));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "online-controlled",
    phase: args.phase,
    configuration: {
      caseIds: args.caseIds,
      models: args.models,
      reasoningEffort: "high",
      maxAttempts: 2,
      repetitions: args.repetitions,
      fallbackAcrossModels: false,
      webSearchEnabled: false,
    },
    models,
  };
  const outputPath = path.resolve(args.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[benchmark] relatório: ${outputPath}`);
  for (const result of models) {
    console.log(
      `${result.model}: ${result.totals.passed}/${result.totals.cases} · p50 ${result.metrics.latencyMsP50 ?? "n/a"} ms · US$ ${result.metrics.totalCostUsd.toFixed(6)}`,
    );
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

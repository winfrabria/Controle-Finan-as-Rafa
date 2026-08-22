import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HarnessFinding } from "../contracts";
import {
  goldenCasesFileSchema,
  type GoldenCase,
} from "./golden-case-schema";
import {
  countSemanticDuplicates,
  emittedQuestionHasObjectiveContradiction,
  formatReadableSummary,
  runGoldenCases,
} from "./runner";

const fixturePath = new URL(
  "./__fixtures__/golden-cases.v1.json",
  import.meta.url,
);

function loadCases(): GoldenCase[] {
  const parsed = goldenCasesFileSchema.safeParse(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );
  assert.equal(parsed.success, true);
  return parsed.success ? parsed.data.cases : [];
}

function finding(overrides: Partial<HarnessFinding>): HarnessFinding {
  return {
    code: "SINTETICO_TESTE",
    title: "Achado sintético",
    description: "Descrição sintética.",
    category: "AMOUNTS",
    severity: "WARNING",
    source: "UNIVERSAL_RULE",
    confidence: 0.99,
    justification: "Justificativa sintética.",
    references: ["POLITICA_AUDITORIA_VIGENTE"],
    evidence: { summary: "Resumo sintético." },
    expectedValue: null,
    actualValue: null,
    noteItemLineNumber: null,
    ...overrides,
  };
}

test("todos os casos dourados do fixture passam no modo offline", () => {
  const report = runGoldenCases(loadCases());
  assert.equal(report.totals.cases, 20);
  assert.equal(report.totals.failed, 0);
  assert.equal(report.mode, "offline");
  assert.equal(report.metrics.classificationAccuracy, 1);
  assert.equal(report.metrics.classificationMacroPrecision, 1);
  assert.equal(report.metrics.classificationMacroRecall, 1);
  assert.equal(report.metrics.classificationMacroF1, 1);
  assert.ok(Object.keys(report.metrics.classificationByLabel).length >= 4);
  assert.equal(report.metrics.schemaValidityRate, 1);
  assert.equal(report.metrics.coverageAreaViolations, 0);
  assert.equal(report.metrics.forbiddenOutputViolations, 0);
});

test("execução é determinística entre chamadas", () => {
  const first = runGoldenCases(loadCases());
  const second = runGoldenCases(loadCases());
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test("modo offline não registra nenhuma chamada de provedor", () => {
  const report = runGoldenCases(loadCases());
  assert.equal(report.onlineTelemetry.providerCalls, 0);
  assert.equal(report.onlineTelemetry.evaluated, false);
  assert.equal(report.onlineTelemetry.costUsd, null);
});

test("classificação inesperada reprova o caso", () => {
  const cases = loadCases();
  cases[0] = {
    ...cases[0],
    expectations: {
      ...cases[0].expectations,
      acceptableClassifications: ["READ_FAILED"],
    },
  };
  const report = runGoldenCases(cases);
  const result = report.results[0];
  assert.equal(result.passed, false);
  const classificationCheck = result.checks.find(
    (check) => check.name === "classification",
  );
  assert.equal(classificationCheck?.passed, false);
});

test("achado proibido emitido reprova o caso", () => {
  const cases = loadCases();
  const target = cases.find((goldenCase) => goldenCase.id === "alcohol-item-suspicious");
  assert.ok(target);
  target.expectations.forbiddenFindingCodes.push("ALCOHOL_ITEM");
  const report = runGoldenCases(cases);
  const result = report.results.find((entry) => entry.id === target.id);
  assert.equal(result?.passed, false);
});

test("pergunta de contexto proibida reprova o caso", () => {
  const cases = loadCases();
  const target = cases.find(
    (goldenCase) => goldenCase.id === "external-context-legitimate-question",
  );
  assert.ok(target);
  const emittedCode = target.input.aiDiscovery?.contextQuestions[0]?.code;
  assert.ok(emittedCode);
  target.expectations.forbiddenContextQuestionCodes.push(emittedCode);
  const report = runGoldenCases(cases);
  const result = report.results.find((entry) => entry.id === target.id);
  assert.equal(result?.passed, false);
});

test("limite de duplicação semântica é respeitado e contado", () => {
  const duplicated = [
    finding({
      code: "A",
      expectedValue: null,
      actualValue: null,
      evidence: { summary: "Mesmo resumo" },
    }),
    finding({
      code: "B",
      expectedValue: null,
      actualValue: null,
      evidence: { summary: "mesmo resumo" },
    }),
  ];
  assert.equal(countSemanticDuplicates(duplicated), 1);
  assert.equal(countSemanticDuplicates([finding({})]), 0);
});

test("contradição objetiva é detectada em perguntas emitidas", () => {
  const contradiction = emittedQuestionHasObjectiveContradiction({
    code: "X",
    options: [],
    prompt: "A venda registra R$ 100,00 enquanto o pagamento registra R$ 150,00.",
    rationale: "ok",
    required: false,
    type: "TEXT",
  });
  assert.equal(contradiction, true);

  const legitimate = emittedQuestionHasObjectiveContradiction({
    code: "Y",
    options: [],
    prompt: "A obra possui limite vigente para despesas de combustível?",
    rationale: "ok",
    required: false,
    type: "BOOLEAN",
  });
  assert.equal(legitimate, false);
});

test("area obrigatoria ausente reprova o caso", () => {
  const cases = loadCases();
  cases[0].expectations.requiredCoverageAreas.push("AREA_INEXISTENTE");
  const result = runGoldenCases(cases).results[0];
  assert.equal(result.passed, false);
  assert.equal(
    result.checks.find((check) => check.name === "requiredCoverageAreas")
      ?.passed,
    false,
  );
});

test("fragmento proibido no payload publico reprova o caso", () => {
  const cases = loadCases();
  cases[0].expectations.forbiddenOutputFragments.push("classification");
  const result = runGoldenCases(cases).results[0];
  assert.equal(result.passed, false);
  assert.equal(
    result.checks.find((check) => check.name === "forbiddenOutputFragments")
      ?.passed,
    false,
  );
});

test("resumo legível menciona totais, métricas e casos reprovados", () => {
  const report = runGoldenCases(loadCases());
  const summary = formatReadableSummary(report);
  assert.match(summary, /Casos: 20 · aprovados: 20 · reprovados: 0/);
  assert.match(summary, /acurácia de classificação: 100\.0%/);
  assert.match(summary, /precisão macro: 100\.0%/);
  assert.match(summary, /recall macro: 100\.0%/);
  assert.match(summary, /F1 macro: 100\.0%/);
  assert.doesNotMatch(summary, /\[FAIL\]/);

  const failing = structuredClone(loadCases());
  failing[0].expectations.acceptableClassifications = ["READ_FAILED"];
  const failedSummary = formatReadableSummary(runGoldenCases(failing));
  assert.match(failedSummary, /\[FAIL\]/);
});

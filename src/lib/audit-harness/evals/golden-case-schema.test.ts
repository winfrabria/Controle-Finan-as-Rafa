import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  GOLDEN_CASES_CONTRACT_VERSION,
  goldenCaseSchema,
  goldenCasesFileSchema,
} from "./golden-case-schema";

const fixturePath = new URL(
  "./__fixtures__/golden-cases.v1.json",
  import.meta.url,
);

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

test("contrato versionado aceita o arquivo de fixtures sintéticas", () => {
  const parsed = goldenCasesFileSchema.safeParse(loadFixture());
  assert.equal(parsed.success, true);
});

test("corpus preserva a cobertura documental explícita dos conjuntos completos", () => {
  const file = goldenCasesFileSchema.parse(loadFixture());
  const complete = file.cases.filter(
    (entry) => entry.input.invoice.supportCoverage?.status === "COMPLETE",
  );
  assert.equal(complete.length, 4);
  for (const entry of complete) {
    assert.ok(entry.input.invoice.supportCoverage?.evidence);
    assert.deepEqual(entry.input.invoice.supportCoverage?.missingDocuments, []);
  }
});

test("corpus inclui todas as categorias genericas da rodada de estabilizacao", () => {
  const file = loadFixture();
  const categories = new Set(
    file.cases.map((goldenCase: { category: string }) => goldenCase.category),
  );
  for (const category of [
    "SERVICE_INVOICE",
    "INVOICE_WITH_PAYMENT_PROOF",
    "FUEL_WITH_REPORT",
    "LEGITIMATE_NEAR_DUPLICATE",
    "GROSS_NET_WITHHOLDING",
    "MULTIPAGE_RECONCILIATION",
    "ZERO_VALUE_AND_GLOBAL_DISCOUNT",
    "OCR_PROMPT_INJECTION",
    "MULTIPLE_LEGITIMATE_TAX_IDS",
    "TIMEZONE_DATE_BOUNDARY",
  ]) {
    assert.equal(categories.has(category), true, `Categoria ausente: ${category}`);
  }
});

test("versão do contrato é fixada em 1.0.0", () => {
  assert.equal(GOLDEN_CASES_CONTRACT_VERSION, "1.0.0");
  const file = loadFixture();
  file.contractVersion = "9.9.9";
  const parsed = goldenCasesFileSchema.safeParse(file);
  assert.equal(parsed.success, false);
});

test("rejeita ids duplicados de casos", () => {
  const file = loadFixture();
  file.cases.push({ ...file.cases[0] });
  const parsed = goldenCasesFileSchema.safeParse(file);
  assert.equal(parsed.success, false);
});

test("rejeita campos desconhecidos no caso", () => {
  const file = loadFixture();
  const parsed = goldenCaseSchema.safeParse({
    ...file.cases[0],
    unexpectedField: true,
  });
  assert.equal(parsed.success, false);
});

test("rejeita classificação fora da enumeração do harness", () => {
  const file = loadFixture();
  const parsed = goldenCaseSchema.safeParse({
    ...file.cases[0],
    expectations: {
      ...file.cases[0].expectations,
      acceptableClassifications: ["PERFECT"],
    },
  });
  assert.equal(parsed.success, false);
});

test("aceita orçamento online opcional e rejeita valores negativos", () => {
  const file = loadFixture();
  const withBudget = {
    ...file.cases[0],
    onlineBudget: { maxCostUsd: 0.5, maxLatencyMsP95: 30_000 },
  };
  assert.equal(goldenCaseSchema.safeParse(withBudget).success, true);

  const negative = {
    ...withBudget,
    onlineBudget: { maxCostUsd: -1 },
  };
  assert.equal(goldenCaseSchema.safeParse(negative).success, false);
});

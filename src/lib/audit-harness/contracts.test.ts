import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_DISCOVERY_JSON_SCHEMA,
  aiDiscoveryResponseSchema,
  harnessFindingSchema,
} from "./contracts";

const finding = {
  code: "AI_PRICE_OUTLIER",
  title: "Preço fora do padrão observado",
  description: "O preço exige revisão humana.",
  category: "PRICE",
  severity: "WARNING",
  source: "AI_DISCOVERY",
  confidence: 0.83,
  justification: "O valor diverge dos demais itens comparáveis presentes.",
  references: ["DANFE:item:1"],
  evidence: { lineNumber: 1, observed: "120.00" },
  expectedValue: "80.00",
  actualValue: "120.00",
  noteItemLineNumber: 1,
};

const aiFinding = {
  ...finding,
  evidence: {
    summary: "O valor observado foi R$ 120,00.",
    field: "items[0].unitPrice",
    source: "documento:página:1",
    page: 1,
    lineNumber: 1,
  },
};

test("aceita descoberta explicável e rejeita campos extras", () => {
  assert.equal(harnessFindingSchema.safeParse(finding).success, true);
  assert.equal(harnessFindingSchema.safeParse({ ...finding, chainOfThought: "segredo" }).success, false);
  assert.equal(aiDiscoveryResponseSchema.safeParse({
  findings: [aiFinding],
  coverage: { sufficientEvidence: true, checkedAreas: ["PRICE"], limitations: [] },
    contextQuestions: [],
    needsContext: false,
    summary: "Um achado adicional.",
  }).success, true);
});

test("aceita referências extensas de reembolso composto dentro do limite", () => {
  const references = Array.from(
    { length: 30 },
    (_, index) => `REEMBOLSO:comprovante:${index + 1}`,
  );

  assert.equal(
    harnessFindingSchema.safeParse({ ...finding, references }).success,
    true,
  );
  assert.equal(
    harnessFindingSchema.safeParse({
      ...finding,
      references: Array.from({ length: 101 }, (_, index) => `REF:${index}`),
    }).success,
    false,
  );
});

test("JSON Schema replica os limites defensivos centrais do contrato Zod", () => {
  const findingProperties =
    AI_DISCOVERY_JSON_SCHEMA.properties.findings.items.properties;
  const coverageProperties =
    AI_DISCOVERY_JSON_SCHEMA.properties.coverage.properties;

  assert.deepEqual(findingProperties.confidence, {
    type: "number",
    minimum: 0,
    maximum: 1,
  });
  assert.equal(findingProperties.references.maxItems, 100);
  assert.equal(AI_DISCOVERY_JSON_SCHEMA.properties.findings.maxItems, 50);
  assert.equal(findingProperties.noteItemLineNumber.minimum, 1);
  assert.equal(findingProperties.evidence.properties.page.minimum, 1);
  assert.equal(findingProperties.expectedValue.maxLength, 1000);
  assert.equal(coverageProperties.checkedAreas.maxItems, 30);
  assert.equal(coverageProperties.limitations.maxItems, 30);
  assert.equal(AI_DISCOVERY_JSON_SCHEMA.properties.summary.maxLength, 4000);
});

test("contrato de descoberta rejeita evidência arbitrária e valores não textuais", () => {
  const base = {
    findings: [aiFinding],
    coverage: { sufficientEvidence: true, checkedAreas: ["PRICE"], limitations: [] },
    contextQuestions: [],
    needsContext: false,
    summary: "Auditoria concluída.",
  };

  assert.equal(aiDiscoveryResponseSchema.safeParse(base).success, true);
  assert.equal(aiDiscoveryResponseSchema.safeParse({
    ...base,
    findings: [{ ...aiFinding, evidence: { observed: "120.00" } }],
  }).success, false);
  assert.equal(aiDiscoveryResponseSchema.safeParse({
    ...base,
    findings: [{ ...aiFinding, expectedValue: 80 }],
  }).success, false);
  assert.equal(aiDiscoveryResponseSchema.safeParse({
    ...base,
    findings: [{ ...aiFinding, noteItemLineNumber: 0 }],
  }).success, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { aiDiscoveryResponseSchema, harnessFindingSchema } from "./contracts";

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

test("aceita descoberta explicável e rejeita campos extras", () => {
  assert.equal(harnessFindingSchema.safeParse(finding).success, true);
  assert.equal(harnessFindingSchema.safeParse({ ...finding, chainOfThought: "segredo" }).success, false);
  assert.equal(aiDiscoveryResponseSchema.safeParse({
    findings: [finding],
    coverage: { sufficientEvidence: true, checkedAreas: ["PRICE"], limitations: [] },
    summary: "Um achado adicional.",
  }).success, true);
});

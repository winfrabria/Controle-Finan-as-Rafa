import assert from "node:assert/strict";
import test from "node:test";
import { costCoverage } from "@/lib/integrations/openrouter/cost-coverage";

test("custo conhecido parcial não transforma timeout em chamada gratuita", () => {
  assert.equal(costCoverage([{ usage: { costUsd: 0.01 } }, {}], 0.01), "PARTIAL");
  assert.equal(costCoverage([{}, {}]), "UNKNOWN");
  assert.equal(costCoverage([{ usage: { costUsd: 0 } }], 0), "KNOWN");
  assert.equal(costCoverage([{ usage: { costUsd: 0.01 } }, { usage: { costUsd: 0.02 } }], 0.03), "KNOWN");
  assert.equal(costCoverage([], 0), "KNOWN");
  assert.equal(costCoverage([]), "UNKNOWN");
});

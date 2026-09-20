import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { readLosslessExtractionSnapshot } from "@/server/testing/isolated-extraction-snapshot";

test("replay preserva cobertura UNKNOWN mesmo com documentos faltantes", () => {
  const snapshot = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", markdown: "Documento sintético", readConfidence: 0.9,
    supportCoverage: { status: "UNKNOWN", basis: "NONE", missingDocuments: ["Comprovante pendente"] }, items: [], warnings: [] });
  const before = structuredClone(snapshot);
  assert.deepEqual(readLosslessExtractionSnapshot(snapshot), before);
  assert.deepEqual(snapshot, before);
  assert.equal(readLosslessExtractionSnapshot(snapshot).supportCoverage?.status, "UNKNOWN");
});

test("replay recusa defaults, campos extras e dados inválidos antes de executar trabalho", () => {
  const snapshot = invoiceExtractionSchema.parse({ markdown: "Documento sintético", readConfidence: 0.9, items: [], warnings: [] });
  for (const value of [ { ...snapshot, currency: undefined }, { ...snapshot, inventedField: true }, { ...snapshot, readConfidence: 7 } ]) {
    const before = structuredClone(value);
    assert.throws(() => readLosslessExtractionSnapshot(value));
    assert.deepEqual(value, before);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { DuplicateCandidate, HarnessInvoice } from "./contracts";
import { evaluateUniversalRules } from "./rules";

const invoice: HarnessInvoice = {
  documentNumber: "SYN-900", supplierName: "Fornecedor sintético", supplierTaxId: "11.222.333/0001-81",
  issuedAt: "2026-07-02", totalAmount: "107.00", readConfidence: 0.95, warnings: [], markdown: "", items: [],
};
const candidate: DuplicateCandidate = { ...invoice, noteId: "prior-synthetic" };
const duplicateFindings = (source: HarnessInvoice, previous: DuplicateCandidate) =>
  evaluateUniversalRules({ invoice: source, duplicates: [previous] }).findings.filter((finding) => finding.category === "DUPLICATE");

test("identidade fiscal completa continua detectando possível repetição", () => {
  const results = duplicateFindings(invoice, { ...candidate, documentNumber: "syn900", supplierTaxId: "11222333000181" });
  assert.equal(results.length, 1);
  assert.equal(results[0].code, "POSSIBLE_DUPLICATE");
  assert.equal(results[0].evidence.matchBasis, "FISCAL_IDENTITY");
});

test("campos ausentes coincidentes não provam identidade fiscal", () => {
  for (const field of ["documentNumber", "supplierTaxId", "issuedAt", "totalAmount"] as const) {
    assert.deepEqual(duplicateFindings({ ...invoice, [field]: null }, { ...candidate, [field]: null }), []);
  }
  assert.deepEqual(duplicateFindings({ ...invoice, documentNumber: " --- " }, { ...candidate, documentNumber: " --- " }), []);
});

test("reenvio dos mesmos bytes é localizado mesmo sem número fiscal, sem alegar pagamento duplicado", () => {
  const originalFileSha256 = "a".repeat(64);
  const results = duplicateFindings({ ...invoice, documentNumber: null, originalFileSha256 },
    { ...candidate, documentNumber: null, originalFileSha256: originalFileSha256.toUpperCase() });
  assert.equal(results.length, 1);
  assert.equal(results[0].code, "DUPLICATE_ATTACHMENT");
  assert.equal(results[0].severity, "WARNING");
  assert.equal(results[0].evidence.matchBasis, "FILE_SHA256");
  assert.match(results[0].description, /não comprova pagamento/);
});

test("hash vazio, inválido ou diferente não prova reenvio", () => {
  for (const originalFileSha256 of [null, "", "fake", "b".repeat(64)]) {
    assert.deepEqual(duplicateFindings({ ...invoice, documentNumber: null, originalFileSha256 },
      { ...candidate, documentNumber: null, originalFileSha256: "a".repeat(64) }), []);
  }
});

test("um mesmo arquivo gera somente um apontamento de repetição", () => {
  const originalFileSha256 = "c".repeat(64);
  assert.deepEqual(duplicateFindings({ ...invoice, originalFileSha256 }, { ...candidate, originalFileSha256 })
    .map((finding) => finding.code), ["DUPLICATE_ATTACHMENT"]);
});

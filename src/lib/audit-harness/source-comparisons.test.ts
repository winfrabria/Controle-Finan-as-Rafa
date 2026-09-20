import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { buildSourceComparisons, compactVerificationInvoice } from "./source-comparisons";

function fixture() {
  return invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", documentNumber: "SYNTHETIC", totalAmount: "46.00",
    markdown: "Texto livre preservado, inclusive observações não estruturadas.", readConfidence: 0.95, warnings: [],
    items: [
      { lineNumber: 1, documentGroup: "group-a", sourceKind: "FISCAL_LINE", sourcePage: 1,
        description: "Cabo tipo A", sourceText: "Cabo tipo A, 10 x 4,60 = 46,00", quantity: "10", unitPrice: "4.60", totalAmount: "46.00" },
      { lineNumber: 2, documentGroup: "group-a", sourceKind: "SHEET", sourcePage: 2,
        description: "Controle sintético", sourceText: "Cabo tipo B, 10 x 4,60 = 46,00", quantity: "10.000", unitPrice: "4.600", totalAmount: "46" },
    ],
  });
}

test("medidas iguais apenas encaminham par único de fontes, sem criar achado ou vínculo econômico", () => {
  const invoice = fixture(); const before = structuredClone(invoice);
  assert.deepEqual(buildSourceComparisons(invoice), { candidates: [{ key: "source-pair:1:2", lineNumbers: [1, 2],
    pages: [1, 2], basis: "IDENTICAL_MEASURES_IN_SAME_GROUP", relationship: "UNCONFIRMED" }], ambiguousMeasureGroups: 0 });
  assert.deepEqual(invoice, before);
});

test("origem desconhecida, outro grupo ou só total igual não inventa correspondência", () => {
  const mutations: Array<(invoice: ReturnType<typeof fixture>) => void> = [
    invoice => { invoice.items[1].sourceKind = "UNKNOWN"; },
    invoice => { invoice.items[1].documentGroup = null; },
    invoice => { invoice.items[1].documentGroup = "other-group"; },
    invoice => { invoice.items[1].quantity = "1"; invoice.items[1].unitPrice = "46"; },
    invoice => { invoice.items[1].sourcePage = null; },
    invoice => { invoice.items[1].sourceText = null; },
  ];
  for (const mutate of mutations) { const invoice = fixture(); mutate(invoice); assert.equal(buildSourceComparisons(invoice).candidates.length, 0); }
});

test("colisão de várias linhas iguais é ambiguidade, não escolha arbitrária de fonte", () => {
  const invoice = fixture(); invoice.items.push({ ...invoice.items[1], lineNumber: 3 });
  assert.deepEqual(buildSourceComparisons(invoice), { candidates: [], ambiguousMeasureGroups: 1 });
});

test("triagem não presume que descrições diferentes sejam inconsistentes", () => {
  const invoice = fixture(); invoice.items[1].sourceText = "Cabo tipo A, 10 x 4,60 = 46,00";
  assert.equal(buildSourceComparisons(invoice).candidates.length, 1);
  assert.equal("findings" in buildSourceComparisons(invoice), false);
});

test("transporte compacto preserva todas as evidências, texto livre, negativos e listas vazias", () => {
  const invoice = fixture(); invoice.items[0].arithmeticVerified = false; invoice.readConfidence = 0;
  const before = structuredClone(invoice); const compact = compactVerificationInvoice(invoice);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(invoice).length);
  assert.deepEqual(invoice, before);
  const value = compact as { markdown: string; items: Array<Record<string, unknown>>; readConfidence: number; warnings: unknown[] };
  assert.equal(value.markdown, invoice.markdown); assert.equal(value.items.length, 2);
  assert.equal(value.items[0].sourceText, invoice.items[0].sourceText);
  assert.equal(value.items[0].arithmeticVerified, false); assert.equal(value.readConfidence, 0);
  assert.deepEqual(value.warnings, []); assert.equal("sourceDate" in value.items[0], false);
});

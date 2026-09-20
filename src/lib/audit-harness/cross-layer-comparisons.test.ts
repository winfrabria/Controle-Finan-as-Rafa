import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { buildCrossLayerDateComparisons } from "./cross-layer-comparisons";
import { buildVerificationChecks } from "./verification";

function fixture() {
  return invoiceExtractionSchema.parse({ documentKind: "REIMBURSEMENT", readConfidence: 0.9, markdown: "Fontes sintéticas", items: [
    { lineNumber: 1, description: "Oficina Horizonte", sourceKind: "SHEET", sourcePage: 1,
      sourceText: "Oficina Horizonte 08/04/2026 R$ 73,50", sourceDate: "2026-04-08", totalAmount: "73.50",
      documentRole: "LINE_ITEM", documentGroup: "leitura-a", countsTowardDocumentTotal: true },
    { lineNumber: 2, description: "Serviço Oficina Horizonte", sourceKind: "RECEIPT", sourcePage: 3,
      sourceText: "Oficina Horizonte 07/04/2026 R$ 73,50", sourceDate: "2026-04-07", totalAmount: "73.50",
      documentRole: "LINE_ITEM", documentGroup: "leitura-b", countsTowardDocumentTotal: false },
  ] });
}

test("grupo diferente e data divergente não silenciam par único entre ficha e recibo", () => {
  const invoice = fixture(), before = structuredClone(invoice);
  assert.deepEqual(buildCrossLayerDateComparisons(invoice), [{ key: "layer-pair:1:2", lineNumbers: [1, 2], pages: [1, 3],
    basis: "UNIQUE_DESCRIPTION_AND_AMOUNT_ACROSS_LAYERS", relationship: "UNCONFIRMED" }]);
  assert.deepEqual(invoice, before, "Attention must not repair hierarchy or create findings.");
  assert.deepEqual(buildVerificationChecks(invoice).find(check => check.key === "layer-pair:1:2")?.sourcePair,
    { lineNumbers: [1, 2], pages: [1, 3] });
  assert.deepEqual(buildVerificationChecks(invoice).find(check => check.key === "layer-pair:1:2")?.fieldReview,
    { field: "DATE", pages: [1, 3] });
});

test("datas iguais também são conferidas, sem seleção dirigida a encontrar erro", () => {
  const invoice = fixture(); invoice.items[1].sourceDate = invoice.items[0].sourceDate;
  assert.equal(buildCrossLayerDateComparisons(invoice).length, 1);
});

test("mesmo valor não basta: descrição genérica, distinta ou parcial não cria par", () => {
  for (const description of ["Oficina", "73,50", "Oficina HorizonteSul", "Oficina Horizonte Sul Alternativa"]) {
    const invoice = fixture(); invoice.items[0].description = description;
    assert.deepEqual(buildCrossLayerDateComparisons(invoice), [], description);
  }
  const invoice = fixture(); invoice.items[1].totalAmount = "73.51";
  assert.deepEqual(buildCrossLayerDateComparisons(invoice), []);
});

test("ambiguidade em qualquer lado não escolhe o recibo com data mais conveniente", () => {
  for (const side of [0, 1]) {
    const invoice = fixture(); invoice.items.push({ ...invoice.items[side], lineNumber: 3, sourceDate: "2026-04-08" });
    assert.deepEqual(buildCrossLayerDateComparisons(invoice), []);
  }
});

test("papel econômico desconhecido, pagamento, data inválida e fonte sem localização não ganham vínculo", () => {
  for (const changes of [ { countsTowardDocumentTotal: null }, { countsTowardDocumentTotal: true },
    { sourceKind: "PAYMENT" as const }, { sourceDate: "2026-02-31" }, { sourcePage: 0 }, { sourceText: "" } ]) {
    const invoice = fixture(); Object.assign(invoice.items[1], changes);
    assert.deepEqual(buildCrossLayerDateComparisons(invoice), [], JSON.stringify(changes));
  }
});

test("centavos e limites de palavra são preservados sem depender de caixa ou acentos", () => {
  const invoice = fixture(); invoice.items[0].description = "OFICÍNA HORIZONTE"; invoice.items[1].totalAmount = "73.5";
  assert.equal(buildCrossLayerDateComparisons(invoice).length, 1);
  invoice.items[1].totalAmount = "0";
  assert.deepEqual(buildCrossLayerDateComparisons(invoice), []);
});

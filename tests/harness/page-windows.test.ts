import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { evidencePageRepairTarget, planPageWindows, remapWindowEvidence,
  replaceWindowPageEvidence } from "@/lib/integrations/openrouter/page-windows";

test("planejamento cobre todas as páginas uma única vez sem ultrapassar o teto", () => {
  for (const count of [1, 3, 5, 23, 64]) {
    const windows = planPageWindows(count, 4, 16);
    assert.deepEqual(windows.flat(), Array.from({ length: count }, (_, index) => index + 1));
    assert.ok(windows.every(window => window.length > 0 && window.length <= 4));
  }
  assert.throws(() => planPageWindows(65, 4, 16), /allowed request count/);
  for (const count of [0, -1, 1.5, Infinity, 501]) assert.throws(() => planPageWindows(count, 4, 16));
});

function extraction() {
  return invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", markdown: "Fonte sintética", readConfidence: 0.9,
    items: [{ lineNumber: 1, description: "Material", sourcePage: 1, sourceText: "Material 12,00", totalAmount: "12",
      evidenceObservations: [{ kind: "PAYMENT", amount: "15", page: 2, text: "DEBITO 15,00" }] }],
    documentObservations: [{ kind: "OTHER", amountScope: "CONTEXT", page: 2, text: "Referência" }],
    requiredFieldChecks: [{ field: "purpose", label: "Finalidade", page: 1, present: false, requiredByDocument: false }],
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE", sources: [{ kind: "SHEET", count: 1 }] },
      { page: 2, complete: true, fieldsReviewed: true, requirementScope: "NONE", sources: [{ kind: "PAYMENT", count: 1 }] }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 1, missingLineNumbers: [] } });
}
test("todas as localizações são convertidas, sem reescrever trechos nem declarar completude global", () => {
  const source = extraction(), before = structuredClone(source);
  const mapped = remapWindowEvidence(source, [17, 18], 23);
  assert.equal(mapped.items[0].sourcePage, 17);
  assert.equal(mapped.items[0].evidenceObservations[0].page, 18);
  assert.equal(mapped.documentObservations![0].page, 18);
  assert.equal(mapped.requiredFieldChecks[0].page, 17);
  assert.deepEqual(mapped.pageCoverage?.map(entry => entry.page), [17, 18]);
  assert.equal(mapped.items[0].sourceText, source.items[0].sourceText);
  assert.equal(mapped.itemCoverage.status, "UNKNOWN");
  assert.deepEqual(source, before);
});
test("mapa repetido, fora do original ou alegação fora da janela são rejeitados", () => {
  for (const map of [[], [2, 2], [24], [0], [1.5]]) assert.throws(() => remapWindowEvidence(extraction(), map, 23));
  assert.throws(() => remapWindowEvidence(extraction(), [20], 23), /outside its page window/);
});

test("reparo focal substitui somente fontes da página e preserva a camada econômica", () => {
  const base = extraction();
  base.items[0].countsTowardDocumentTotal = true;
  base.items[0].evidenceObservations = [];
  base.items.push({ ...structuredClone(base.items[0]), lineNumber: 2, sourcePage: 2,
    countsTowardDocumentTotal: false, description: "Controle parcial", sourceText: "Controle A 15,00",
    totalAmount: "15", evidenceObservations: [{ kind: "SHEET", documentGroup: null, label: null,
      amount: "15", date: null, page: 2, text: "Controle A 15,00" }] });
  const onePage = invoiceExtractionSchema.parse({ ...extraction(), items: [15, 18].map((amount, index) => ({
    ...structuredClone(extraction().items[0]), lineNumber: index + 1, sourcePage: 2,
    description: `Controle ${index + 1}`, totalAmount: String(amount), sourceText: `Controle ${index + 1} ${amount},00`,
    countsTowardDocumentTotal: true, evidenceObservations: [{ kind: "SHEET", documentGroup: null, label: null,
      amount: String(amount), date: null, page: 2, text: `Controle ${index + 1} ${amount},00` }],
  })), documentObservations: [], requiredFieldChecks: [],
    pageCoverage: [{ page: 2, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      sources: [{ kind: "SHEET", count: 2 }] }],
    itemCoverage: { status: "UNKNOWN", extractedItemCount: 2, missingLineNumbers: [] } });
  const before = structuredClone(base);
  const result = replaceWindowPageEvidence(base, onePage, 2,
    { preserveReplacementEconomicLayer: false, replacementItemCoverageComplete: true });
  assert.ok(result);
  assert.deepEqual(base, before);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(item => item.countsTowardDocumentTotal), [true, false, false]);
  assert.equal(result.itemCoverage.status, "COMPLETE");
  assert.equal(result.pageCoverage?.[1].sources[0].count, 2);
  assert.deepEqual(result.pageCoverage?.[1].sources, [
    { kind: "SHEET", count: 2 }, { kind: "PAYMENT", count: 1 },
  ]);
});

test("alvo focal exige déficit real, fonte financeira e página limitada", () => {
  const target = evidencePageRepairTarget({ diagnostic: "evidence-source-not-extracted",
    details: { page: 4, kind: "SHEET", expectedSources: 18, extractedSources: 1 } }, 4);
  assert.deepEqual(target, { page: 4, kind: "SHEET", expectedSources: 18, extractedSources: 1 });
  for (const details of [
    { page: 5, kind: "SHEET", expectedSources: 18, extractedSources: 1 },
    { page: 4, kind: "OTHER", expectedSources: 18, extractedSources: 1 },
    { page: 4, kind: "SHEET", expectedSources: 1, extractedSources: 1 },
  ]) assert.equal(evidencePageRepairTarget({ diagnostic: "evidence-source-not-extracted", details }, 4), null);
  assert.deepEqual(evidencePageRepairTarget({ diagnostic: "evidence-source-fiscal-row-not-inventoried",
    details: { page: 2, kind: "FISCAL_LINE", lineNumber: 7 } }, 4),
  { page: 2, kind: "FISCAL_LINE", expectedSources: 1, extractedSources: 0 });
  assert.equal(evidencePageRepairTarget({ diagnostic: "evidence-page-review-incomplete",
    details: { page: 2, kind: "SHEET" } }, 4), null);
});

test("reparo focal preserva a leitura fiscal aritmeticamente consistente", () => {
  const fiscal = (unitPrice: string, text: string) => invoiceExtractionSchema.parse({ documentKind: "FISCAL_INVOICE",
    totalAmount: "35.03", markdown: text, readConfidence: 0.95, items: [{ lineNumber: 1, code: "000944",
      description: "LINGUICA CASEIRA FRANGO KG", quantity: "1.188", unitPrice, totalAmount: "35.03",
      sourceKind: "FISCAL_LINE", sourcePage: 1, sourceText: text, countsTowardDocumentTotal: true }],
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      sources: [{ kind: "FISCAL_LINE", count: 1 }] }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 1, firstLineNumber: 1,
      lastLineNumber: 1, missingLineNumbers: [] } });
  const base = fiscal("29.4865", "000944 LINGUICA KG 1,188 29,4865 35,03");
  const reread = fiscal("29.9925", "000944 LINGUICA KG 1,188 29,9925 35,03");
  base.items[0].documentGroup = "EXPENSE_001";
  base.items[0].documentRole = "LINE_ITEM";
  reread.items[0].documentGroup = "NF-352080";
  reread.items[0].countsTowardDocumentTotal = false;
  reread.documentObservations = [{ kind: "OTHER", amountScope: "CONTEXT", page: 1,
    text: "Nº 352080 SÉRIE 1 FOLHA 1 DE 2", documentGroup: "NF-352080",
    label: null, amount: null, date: null }];
  const before = structuredClone({ base, reread });
  const result = replaceWindowPageEvidence(base, reread, 1,
    { preserveReplacementEconomicLayer: true, replacementItemCoverageComplete: true });
  assert.ok(result);
  assert.equal(result.items[0].unitPrice, "29.4865");
  assert.equal(result.items[0].sourceText, base.items[0].sourceText);
  assert.equal(result.items[0].documentGroup, "EXPENSE_001");
  assert.equal(result.items[0].countsTowardDocumentTotal, true);
  assert.equal(result.documentObservations?.[0].documentGroup, "EXPENSE_001");
  assert.deepEqual({ base, reread }, before);
  const ambiguous = fiscal("29.5000", "000944 LINGUICA KG 1,188 29,5000 35,03");
  assert.equal(replaceWindowPageEvidence(base, ambiguous, 1,
    { preserveReplacementEconomicLayer: true, replacementItemCoverageComplete: true }), null);
});

test("reparo focal troca total fiscal sem lastro pelo total aritmético visível e preserva o desconto separado", () => {
  const page = (total: string, text: string, withDiscount: boolean) => invoiceExtractionSchema.parse({
    documentKind: "COMPOSITE", totalAmount: "10", markdown: text, readConfidence: 0.95,
    items: [{ lineNumber: 1, code: "005681", description: "ESTACA DE MADEIRA", quantity: "4",
      unitPrice: "3", totalAmount: total, sourceKind: "FISCAL_LINE", sourcePage: 1,
      sourceText: text, countsTowardDocumentTotal: true }, ...(withDiscount ? [{ lineNumber: 2,
      description: "DESCONTOS", totalAmount: "-2", sourceKind: "SALE" as const, sourcePage: 1,
      sourceText: "DESCONTOS 2,00", countsTowardDocumentTotal: true }] : [])],
    documentObservations: withDiscount ? [{ kind: "SALE" as const, amountScope: "DOCUMENT_TOTAL" as const,
      amount: "10", page: 1, text: "TOTAL GERAL 10,00" }] : [],
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      sources: [{ kind: "FISCAL_LINE", count: 1 }, ...(withDiscount ? [{ kind: "SALE" as const, count: 1 }] : [])] }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: withDiscount ? 2 : 1,
      firstLineNumber: 1, lastLineNumber: withDiscount ? 2 : 1, missingLineNumbers: [] },
  });
  const base = page("10", "005681 ESTACA DE MADEIRA 4 3,00 12,00", false);
  const reread = page("12", "005681 ESTACA DE MADEIRA 4 3,00 12,00", true);
  const result = replaceWindowPageEvidence(base, reread, 1,
    { preserveReplacementEconomicLayer: true, replacementItemCoverageComplete: true });
  assert.ok(result);
  assert.deepEqual(result.items.map(item => item.totalAmount), ["12", "-2"]);
  assert.deepEqual(result.items.map(item => item.countsTowardDocumentTotal), [true, true]);
});

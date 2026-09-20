import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import { getContextOnlyCoverageGaps, getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";

function fixture() {
  const parsed = parseInvoiceExtractionPayload({ documentKind: "COMPOSITE", totalAmount: "37.00",
    markdown: "Documento sintético com linha financeira e uma página de contexto sem registro estruturado.", readConfidence: 0.99,
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [], evidence: "Uma linha financeira." },
    items: [{ lineNumber: 1, description: "Material", quantity: "1", unitPrice: "37.00", totalAmount: "37.00",
      countsTowardDocumentTotal: true, sourceKind: "FISCAL_LINE", sourcePage: 1, sourceText: "Material 1 x 37,00 = 37,00" }],
    pageCoverage: ["FISCAL_LINE", "OTHER"].map((kind, index) => ({ page: index + 1, complete: true, fieldsReviewed: true,
      requirementScope: "NONE", requirementEvidence: null, sources: [{ kind, count: 1 }] })),
  });
  assert.ok(parsed.success);
  return parsed.data;
}

test("lacuna isolada de contexto permite só análise parcial, sem apagar ou completar o inventário", () => {
  const invoice = fixture();
  const before = structuredClone(invoice);
  assert.deepEqual(getContextOnlyCoverageGaps(invoice, 2), [{ page: 2, kind: "OTHER", expectedSources: 1, extractedSources: 0 }]);
  assert.deepEqual(invoice, before);
  assert.equal(getEvidenceCoverageLimitation(invoice, 2)?.diagnostic, "evidence-source-not-extracted");
});

test("fontes contextuais já presentes mantêm contagem distinta e a lacuna declarada", () => {
  const invoice = fixture();
  invoice.pageCoverage![1].sources[0].count = 3;
  const observation = { kind: "OTHER" as const, amountScope: "CONTEXT" as const, amount: null, date: null,
    page: 2, text: "Referência de contexto sintética", documentGroup: null, label: null };
  invoice.documentObservations = [observation, { ...observation }];
  assert.deepEqual(getContextOnlyCoverageGaps(invoice, 2), [{ page: 2, kind: "OTHER", expectedSources: 3, extractedSources: 1 }]);
  assert.equal(invoice.documentObservations.length, 2);
  assert.equal(invoice.pageCoverage![1].sources[0].count, 3);
});

test("fonte financeira, instrução pendente ou estrutura desconhecida nunca usa o caminho parcial", () => {
  const mutations: Array<(invoice: ReturnType<typeof fixture>) => void> = [
    invoice => { invoice.pageCoverage![1].sources[0].kind = "PAYMENT"; },
    invoice => { invoice.pageCoverage![1].complete = false; },
    invoice => { invoice.pageCoverage![1].fieldsReviewed = false; },
    invoice => { invoice.pageCoverage![1].requirementScope = "UNKNOWN"; },
    invoice => { invoice.pageCoverage![1].requirementScope = "ALL_FIELDS"; },
    invoice => { invoice.itemCoverage.status = "UNKNOWN"; },
    invoice => { invoice.itemCoverage.missingLineNumbers = [2]; },
    invoice => { invoice.items[0].sourceKind = "UNKNOWN"; },
    invoice => { invoice.items[0].sourcePage = null; },
    invoice => { invoice.items[0].sourceText = null; },
    invoice => { invoice.items[0].sourcePage = 2; },
    invoice => { invoice.documentObservations = [{ kind: "OTHER", amountScope: "UNKNOWN", amount: null, date: null,
      page: 2, text: "Fonte ambígua", documentGroup: null, label: null }]; invoice.pageCoverage![1].sources[0].count = 2; },
    invoice => { invoice.documentObservations = [{ kind: "OTHER", amountScope: "CONTEXT", amount: "37.00", date: null,
      page: 2, text: "Total 37,00", documentGroup: null, label: null }]; invoice.pageCoverage![1].sources[0].count = 2; },
  ];
  for (const mutate of mutations) { const invoice = fixture(); mutate(invoice); assert.equal(getContextOnlyCoverageGaps(invoice, 2), null); }
});

test("outro defeito financeiro depois da primeira lacuna impede auditoria parcial", () => {
  const invoice = fixture();
  invoice.pageCoverage!.push({ page: 3, complete: true, fieldsReviewed: true, requirementScope: "NONE",
    requirementEvidence: null, sources: [{ kind: "PAYMENT", count: 1 }] });
  assert.equal(getEvidenceCoverageLimitation(invoice, 3)?.details.kind, "OTHER");
  assert.equal(getContextOnlyCoverageGaps(invoice, 3), null);
});

test("inventário completo não é reclassificado como parcial", () => {
  const invoice = fixture();
  invoice.pageCoverage![1].sources = [];
  assert.equal(getEvidenceCoverageLimitation(invoice, 2), null);
  assert.equal(getContextOnlyCoverageGaps(invoice, 2), null);
  assert.equal(getContextOnlyCoverageGaps(fixture(), null), null);
});

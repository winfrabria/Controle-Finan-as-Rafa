import assert from "node:assert/strict";
import test from "node:test";

import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { matchedEconomicSupportLines } from "@/lib/integrations/openrouter/support-matching";

test("apoio global usa vínculo forte e não aceita grupo, soma ou valor ambíguo isoladamente", () => {
  const invoice = invoiceExtractionSchema.parse({ documentKind: "REIMBURSEMENT", totalAmount: "38",
    markdown: "Ficha e comprovantes sintéticos", readConfidence: 0.95, items: [
      { lineNumber: 1, description: "CASA DA UVA", sourceKind: "SHEET", sourcePage: 1,
        sourceDate: "2026-05-15", sourceText: "1 15/05/2026 CASA DA UVA 13,00", totalAmount: "13",
        countsTowardDocumentTotal: true },
      { lineNumber: 2, description: "RESTAURANTE FAZENDINHA", sourceKind: "SHEET", sourcePage: 1,
        sourceDate: "2026-05-19", sourceText: "2 19/05/2026 RESTAURANTE FAZENDINHA 15,00", totalAmount: "15",
        countsTowardDocumentTotal: true },
      { lineNumber: 3, description: "RESTAURANTE PITDOG", sourceKind: "SHEET", sourcePage: 1,
        sourceDate: "2026-05-15", sourceText: "3 15/05/2026 RESTAURANTE PITDOG 10,00", totalAmount: "10",
        documentGroup: "wrong-model-group", countsTowardDocumentTotal: true },
      { lineNumber: 4, description: "Pão de queijo", sourceKind: "FISCAL_LINE", sourcePage: 2,
        sourceText: "Pão de queijo 5,00", totalAmount: "5", documentGroup: "fiscal-13",
        countsTowardDocumentTotal: false },
      { lineNumber: 5, description: "Café", sourceKind: "FISCAL_LINE", sourcePage: 2,
        sourceText: "Café 8,00", totalAmount: "8", documentGroup: "fiscal-13",
        countsTowardDocumentTotal: false },
      { lineNumber: 6, description: "Consumo Restaurante Fazendinha", sourceKind: "SALE", sourcePage: 3,
        sourceDate: "2026-05-18", sourceText: "Restaurante Fazendinha total 15,00 18/05/2026", totalAmount: "15",
        documentGroup: "fazendinha-15", countsTowardDocumentTotal: false },
      { lineNumber: 7, description: "Outro comprovante", sourceKind: "RECEIPT", sourcePage: 4,
        sourceText: "Total 10,00", totalAmount: "10", documentGroup: "ambiguous-a",
        countsTowardDocumentTotal: false },
      { lineNumber: 8, description: "Outro comprovante", sourceKind: "RECEIPT", sourcePage: 5,
        sourceText: "Total 10,00", totalAmount: "10", documentGroup: "ambiguous-b",
        countsTowardDocumentTotal: false },
      { lineNumber: 9, description: "Pitdog outra operação", sourceKind: "RECEIPT", sourcePage: 6,
        sourceDate: "2026-05-29", sourceText: "Restaurante Pitdog 31,00 29/05/2026", totalAmount: "31",
        documentGroup: "wrong-model-group", countsTowardDocumentTotal: false },
      { lineNumber: 10, description: "ALTYINFORMATICA", sourceKind: "SHEET", sourcePage: 1,
        sourceDate: "2026-05-18", sourceText: "18/05/2026 ALTYINFORMATICA 30,00", totalAmount: "30",
        countsTowardDocumentTotal: true },
      { lineNumber: 11, description: "Altycel Informatica", sourceKind: "RECEIPT", sourcePage: 7,
        sourceText: "ALTYCEL INFORMATICA R$ 30,00 18/MAI/2026", totalAmount: "30",
        documentGroup: "altycel-30", countsTowardDocumentTotal: false },
    ], documentObservations: [{ kind: "RECEIPT", amountScope: "DOCUMENT_TOTAL", amount: "13",
      date: "2026-05-15", page: 2, text: "Casa da Uva total 13,00 15/05/2026",
      documentGroup: "fiscal-13", label: "Total" }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 4, firstLineNumber: 1,
      lastLineNumber: 10, missingLineNumbers: [] } });

  assert.deepEqual([...matchedEconomicSupportLines(invoice)].sort((a, b) => a - b), [1, 2, 10]);
});

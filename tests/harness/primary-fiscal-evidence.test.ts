import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { getInvoiceExtractionLimitation, OpenRouterInvoiceExtractionClient } from "@/server/integrations/openrouter/client";

function fixture() {
  const parsed = parseInvoiceExtractionPayload({ documentKind: "REIMBURSEMENT", totalAmount: "49.00",
    readConfidence: 0.95, markdown: "Ficha com detalhe fiscal sintético.",
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1, firstLineNumber: 1,
      lastLineNumber: 1, missingLineNumbers: [], evidence: "Uma despesa e seu detalhe fiscal em camada separada." },
    items: [
      { lineNumber: 1, description: "Material", totalAmount: "49.00", sourceKind: "SHEET", sourcePage: 1,
        sourceText: "Material 49,00", documentGroup: "a", documentRole: "LINE_ITEM", countsTowardDocumentTotal: true },
      { lineNumber: 2, description: "Material", totalAmount: "49.00", sourceKind: "FISCAL_LINE", sourcePage: 2,
        sourceText: "Material 2 UN x 24,50 = 49,00", quantity: "2", unitPrice: "24.50", sourceDate: null,
        documentGroup: "a", documentRole: "SUPPORTING_DOCUMENT", countsTowardDocumentTotal: false,
        parentLineNumber: 1, evidenceObservations: [] },
    ], pageCoverage: ["SHEET", "FISCAL_LINE"].map((kind, index) => ({ page: index + 1, complete: true,
      fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null, sources: [{ kind, count: 1 }] })),
  });
  assert.ok(parsed.success); return parsed.data;
}

test("detalhe fiscal localizado no reembolso não precisa duplicar sua própria evidência", () => {
  const invoice = fixture(), original = structuredClone(invoice);
  assert.equal(getInvoiceExtractionLimitation(invoice, "application/pdf"), null);
  assert.equal(getEvidenceCoverageLimitation(invoice, 2), null);
  assert.equal(invoice.items[1].evidenceObservations.length, 0);
  assert.deepEqual(invoice, original);
});

test("exceção fiscal exige tipo explícito, página positiva, trecho e valor rastreável", () => {
  for (const changed of ["kind", "page", "text", "amount"] as const) {
    const invoice = fixture(), row = invoice.items[1];
    if (changed === "kind") row.sourceKind = "UNKNOWN";
    if (changed === "page") row.sourcePage = 0;
    if (changed === "text") row.sourceText = "";
    if (changed === "amount") row.totalAmount = "53.00";
    assert.equal(getInvoiceExtractionLimitation(invoice, "application/pdf")?.diagnostic,
      "pdf-evidence-observations-missing", changed);
  }
});

test("linha fiscal não substitui pagamento nem inventário completo", () => {
  for (const changed of ["payment", "count", "inventory"] as const) {
    const invoice = fixture();
    if (changed === "payment") invoice.pageCoverage![1].sources.push({ kind: "PAYMENT", count: 1 });
    if (changed === "count") invoice.pageCoverage![1].sources[0].count = 2;
    if (changed === "inventory") invoice.pageCoverage![1].sources = [];
    assert.ok(getEvidenceCoverageLimitation(invoice, 2), changed);
  }
});

test("cliente não compra recuperação redundante quando detalhe fiscal já tem fonte própria", async () => {
  let calls = 0;
  const client = new OpenRouterInvoiceExtractionClient({ apiKey: "synthetic", model: "google/gemini-3.1-flash-lite",
    fallbackModel: "google/gemini-3.7-flash", pdfEngine: "native", reasoningEffort: "low", maxAttempts: 2,
    timeoutMs: 1000, extractionQualityGateEnabled: true, fetchImplementation: async () => {
      calls++; return new Response(JSON.stringify({ model: "google/gemini-3.1-flash-lite", choices: [{
        message: { content: JSON.stringify(fixture()) }, finish_reason: "stop" }], usage: { cost: 0.01 } }));
    } });
  const result = await client.extractInvoice({ fileName: "synthetic.pdf", mimeType: "application/pdf", pageCount: 2,
    signedUrl: "https://storage.test/synthetic.pdf" });
  assert.equal(calls, 1); assert.equal(result.attempts, 1); assert.equal(result.qualityLimitation, undefined);
  assert.equal(result.data.items.length, 2); assert.equal(result.data.items[1].countsTowardDocumentTotal, false);
});

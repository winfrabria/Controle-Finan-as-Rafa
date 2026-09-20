import assert from "node:assert/strict";
import test from "node:test";
import { applyEvidenceRepair, applyEvidenceRepairWithTrace, canRepairEvidenceInventory, evidenceRepairPrompt } from "@/lib/integrations/openrouter/evidence-repair";
import { invoiceExtractionSchema, type InvoiceExtraction } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { observationQuoteConflict } from "@/lib/integrations/openrouter/source-value-consistency";
import { OpenRouterInvoiceExtractionClient } from "@/server/integrations/openrouter/client";
import { FAST_EXTRACTION_MODEL, FAST_EXTRACTION_REVIEW_MODEL } from "@/lib/audit-harness/versions";

function baseInvoice() {
  return invoiceExtractionSchema.parse({ documentKind: "REIMBURSEMENT", currency: "BRL", documentNumber: null,
    supplierName: null, supplierTaxId: null, issuedAt: "2026-07-01", totalAmount: "17.00", markdown: "Documento sintético.",
    readConfidence: 0.9, warnings: [], itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [], evidence: "Uma despesa." },
    items: [{ lineNumber: 1, description: "Despesa sintética", quantity: "1", unitPrice: "17.00", totalAmount: "17.00",
      sourcePage: 1, sourceText: "Despesa 17,00", documentRole: "LINE_ITEM", countsTowardDocumentTotal: true, evidenceObservations: [] }],
  });
}
type PageCoverage = NonNullable<InvoiceExtraction["pageCoverage"]>[number];
const page = (number: number, kinds: PageCoverage["sources"][number]["kind"][]): PageCoverage => ({ page: number, complete: true, fieldsReviewed: true,
  requirementScope: "NONE", requirementEvidence: null, sources: kinds.map((kind) => ({ kind, count: 1 })) });
function repair() {
  return { pages: [page(1, ["SHEET"]), page(2, ["RECEIPT", "PAYMENT"])],
    records: [
      { line: 1, kind: "SHEET", scope: "ITEM_TOTAL", amount: "17.00", date: "2026-07-01", page: 1, quote: "Total 17,00" },
      { line: 1, kind: "RECEIPT", scope: "ITEM_TOTAL", amount: "17.00", date: "2026-07-01", page: 2, quote: "Total recibo 17,00" },
      { line: 1, kind: "PAYMENT", scope: "ITEM_TOTAL", amount: "19.00", date: "2026-07-01", page: 2, quote: "Pagamento R$ 19,00" },
    ], supportCoverage: { status: "UNKNOWN", basis: "NONE", evidence: null, referencedDocuments: [], presentDocuments: [], missingDocuments: [] },
    requiredFieldChecks: [], unmappedItemCount: 0, warnings: [],
  };
}

test("releitura representa a fonte fiscal sem inventar planilha e rejeita valor/página trocados", () => {
  const base = baseInvoice(); base.documentKind = "FISCAL_INVOICE";
  base.items[0].sourceKind = "FISCAL_LINE";
  base.items[0].sourceDate = "2026-07-01";
  const payload = { pages: [page(1, ["FISCAL_LINE"])], records: [{line:1,kind:"FISCAL_LINE",scope:"ITEM_TOTAL",amount:"17.00",date:null,page:1,quote:"Serviço 17,00"}],
    supportCoverage:{status:"COMPLETE",basis:"DOCUMENT_REFERENCES",referencedDocuments:[],presentDocuments:[],missingDocuments:[]},
    requiredFieldChecks:[],unmappedItemCount:0,warnings:[] };
  const repaired = applyEvidenceRepair(base, payload, 1);
  assert.ok(repaired);
  assert.equal(repaired.items[0].sourceKind,"FISCAL_LINE");
  assert.equal(repaired.items[0].sourceText,"Serviço 17,00");
  assert.equal(repaired.items[0].evidenceObservations.length,0);
  assert.equal(repaired.items[0].sourceDate,"2026-07-01");
  assert.equal(applyEvidenceRepair(base,{...payload,records:[{...payload.records[0],date:"2026-07-02",quote:"Serviço 17,00 02/07/2026"}]},1),null);
  assert.equal(applyEvidenceRepair(base,{...payload,records:[payload.records[0],payload.records[0]]},1),null);
  assert.equal(applyEvidenceRepair(base,{...payload,records:[{...payload.records[0],amount:"19.00"}]},1),null);
  assert.equal(applyEvidenceRepair(base,{...payload,records:[{...payload.records[0],page:2}]},1),null);
});

test("falha de recuperação registra a causa sem conteúdo privado do provedor", () => {
  const reasons: Array<{reason:string;details?:Record<string,unknown>}> = [];
  const rejected = applyEvidenceRepairWithTrace(baseInvoice(), {...repair(), unmappedItemCount:2}, 2,
    (reason, details) => { reasons.push({reason,details}); });
  assert.equal(rejected,null);
  assert.deepEqual(reasons,[{reason:"UNMAPPED_FINANCIAL_ROWS",details:{count:2}}]);
});

test("documento composto preserva linha fiscal primária sem exigir planilha na página fiscal", () => {
  const base = baseInvoice();
  base.items[0].sourceKind = "FISCAL_LINE";
  base.items[0].sourceDate = "2026-07-01";
  const payload = { pages:[page(1,["FISCAL_LINE"]),page(2,["SHEET"])],
    records:[{line:null,kind:"SHEET",scope:"DOCUMENT_TOTAL",amount:"17.00",date:null,page:2,quote:"Total do controle 17,00"}],
    supportCoverage:{status:"COMPLETE",basis:"DOCUMENT_REFERENCES",referencedDocuments:[],presentDocuments:[],missingDocuments:[]},
    requiredFieldChecks:[],unmappedItemCount:0,warnings:[] };
  const repaired = applyEvidenceRepair(base,payload,2);
  assert.ok(repaired);
  assert.equal(repaired.items[0].sourceKind,"FISCAL_LINE");
  assert.equal(repaired.items[0].evidenceObservations.length,0);
  assert.equal(repaired.documentObservations?.[0].page,2);
  assert.equal(getEvidenceCoverageLimitation(repaired,2),null);
  // A genuine reimbursement sheet still needs its own observed primary row.
  base.items[0].sourceKind = "SHEET";
  assert.equal(applyEvidenceRepair(base,payload,2),null);
});

test("segunda leitura compacta preserva camadas, liga fontes e não reescreve os valores fiscais", () => {
  const base = baseInvoice();
  const result = applyEvidenceRepair(base, repair(), 2);
  assert.ok(result);
  assert.equal(result.items[0].totalAmount, "17.00");
  assert.equal(result.items[0].evidenceObservations.length, 3);
  assert.equal(result.items[0].evidenceObservations[2].amount, "19.00");
  assert.equal(getEvidenceCoverageLimitation(result, 2), null);
  assert.match(evidenceRepairPrompt(base, 2), /untrusted_row_index/);
});

test("reparação recusa páginas omitidas, linhas inventadas, campos ausentes ou despesas sem correspondência", () => {
  for (const mutate of [
    (input: ReturnType<typeof repair>) => { input.pages.pop(); },
    (input: ReturnType<typeof repair>) => { input.pages[1].page = 1; },
    (input: ReturnType<typeof repair>) => { input.records[0].line = 99; },
    (input: ReturnType<typeof repair>) => { input.records[0].page = 99; },
    (input: ReturnType<typeof repair>) => { input.records.shift(); },
    (input: ReturnType<typeof repair>) => { input.unmappedItemCount = 1; },
  ]) { const input = repair(); mutate(input); assert.equal(applyEvidenceRepair(baseInvoice(), input, 2), null); }
});

test("revisar inventário não promove cobertura desconhecida de itens nem corrige hierarquia por palpite", () => {
  const base = baseInvoice();
  assert.equal(canRepairEvidenceInventory(base, "evidence-source-not-extracted"), true);
  assert.equal(canRepairEvidenceInventory(base, "evidence-economic-relationship-unknown"), false);
  base.itemCoverage.status = "UNKNOWN";
  assert.equal(canRepairEvidenceInventory(base, "evidence-source-not-extracted"), false);
});

test("reparo de observações não pode recuperar linhas fiscais ausentes ou sem trecho", () => {
  const base = baseInvoice();
  base.pageCoverage = [page(1, ["SHEET"]), page(2, ["FISCAL_LINE"])];
  const snapshot = structuredClone(base);
  assert.equal(canRepairEvidenceInventory(base, "evidence-source-not-extracted"), false);
  // A different, earlier diagnostic must not route this same incomplete row set
  // into a format that cannot add the omitted fiscal row.
  assert.equal(canRepairEvidenceInventory(base, "evidence-required-instruction-not-applied"), false);
  assert.deepEqual(base, snapshot);
  base.items.push({ ...base.items[0], lineNumber: 2, sourceKind: "FISCAL_LINE", sourcePage: 2,
    sourceText: "Produto 17,00", documentRole: "SUPPORTING_DOCUMENT", countsTowardDocumentTotal: false });
  assert.equal(canRepairEvidenceInventory(base, "evidence-source-not-extracted"), true);
  base.items[1].sourceText = null;
  assert.equal(canRepairEvidenceInventory(base, "evidence-source-not-extracted"), false);
});

test("lacuna fiscal escolhe releitura completa e preserva modelo distinto e limite de duas chamadas", async () => {
  const first = baseInvoice();
  first.pageCoverage = [page(1, ["SHEET"]), page(2, ["FISCAL_LINE"])];
  const second = structuredClone(first);
  second.items.push({ ...second.items[0], lineNumber: 2, sourceKind: "FISCAL_LINE", sourcePage: 2,
    sourceText: "Produto 17,00", documentRole: "SUPPORTING_DOCUMENT", countsTowardDocumentTotal: false });
  second.itemCoverage.declaredItemCount = 2; second.itemCoverage.extractedItemCount = 2; second.itemCoverage.lastLineNumber = 2;
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({ apiKey: "synthetic", model: FAST_EXTRACTION_MODEL,
    pdfModel: FAST_EXTRACTION_MODEL, pdfFallbackModel: FAST_EXTRACTION_REVIEW_MODEL, pdfEngine: "native",
    extractionQualityGateEnabled: true, reasoningEffort: "low", maxAttempts: 2, timeoutMs: 1000, sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)); payloads.push(payload);
      return new Response(JSON.stringify({ model: payload.model, choices: [{ message: {
        content: JSON.stringify(payloads.length === 1 ? first : second),
      }, finish_reason: "stop" }] }), { status: 200 });
    } });
  const result = await client.extractInvoice({ fileName: "synthetic.pdf", mimeType: "application/pdf",
    signedUrl: "https://storage.test/synthetic.pdf", pageCount: 2 });
  assert.equal(payloads.length, 2);
  assert.notEqual(payloads[0].model, payloads[1].model);
  assert.equal((payloads[1].response_format as { json_schema: { name: string } }).json_schema.name, "invoice_extraction");
  assert.match(JSON.stringify(payloads[1].messages), /file_data/);
  assert.equal(result.data.items.length, 2);
  assert.equal(result.attemptTrace?.[1].recoveryMode, "quality");
});

test("inconsistência entre valor e trecho é limitação da extração, não um achado financeiro", () => {
  assert.equal(observationQuoteConflict({ amount: "17.00", text: "Total 19,00", amountScope: "ITEM_TOTAL" }), true);
  for (const text of ["Total 17,00", "17/06/2026", "Quantidade 19,00", "Subtotal R$ 19,00 desconto R$ 2,00 total R$ 17,00"]) {
    assert.equal(observationQuoteConflict({ amount: "17.00", text, amountScope: "ITEM_TOTAL" }), false);
  }
  const result = applyEvidenceRepair(baseInvoice(), repair(), 2)!;
  result.items[0].evidenceObservations[0].text = "Total 19,00";
  assert.equal(getEvidenceCoverageLimitation(result, 2)?.diagnostic, "evidence-source-value-quote-conflict");
});

test("recuperação de evidência usa segundo modelo e original, em duas chamadas no máximo", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({ apiKey: "synthetic", model: FAST_EXTRACTION_MODEL,
    pdfModel: FAST_EXTRACTION_MODEL, pdfFallbackModel: FAST_EXTRACTION_REVIEW_MODEL, pdfEngine: "native",
    extractionQualityGateEnabled: true, reasoningEffort: "low", extractionFallbackReasoningEffort: "low",
    maxAttempts: 2, timeoutMs: 1000, sleep: async () => undefined,
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)); payloads.push(payload);
      return new Response(JSON.stringify({ model: payload.model, choices: [{ message: {
        content: JSON.stringify(payloads.length === 1 ? baseInvoice() : repair()),
      }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.extractInvoice({ fileName: "synthetic.pdf", signedUrl: "https://storage.test/synthetic.pdf",
    mimeType: "application/pdf", pageCount: 2 });
  assert.equal(result.attempts, 2);
  assert.equal(result.qualityLimitation, undefined);
  assert.equal(result.data.items[0].evidenceObservations.length, 3);
  assert.match(JSON.stringify(payloads[1].messages), /file_data/);
  assert.match(JSON.stringify(payloads[1].plugins), /native/);
  assert.equal((payloads[1].response_format as { json_schema: { name: string } }).json_schema.name, "invoice_evidence_repair");
  assert.equal(result.attemptTrace?.[1].diagnostic, "evidence-focused-repair");
});

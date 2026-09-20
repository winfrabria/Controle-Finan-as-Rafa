import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { consolidationSourceIssue, validateExtractionWindows } from "@/lib/integrations/openrouter/window-consolidation";
import { OpenRouterClientError, type InvoiceExtractionRequest, type InvoiceExtractionResult } from "@/server/integrations/openrouter/client";
import { WindowedExtractionClient, type WindowExtractionEvent } from "@/server/integrations/openrouter/windowed-extraction";
import { getOpenRouterConfig } from "@/server/integrations/openrouter/config";

const config = getOpenRouterConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic", OPENROUTER_EXTRACTION_PIPELINE: "adaptive" }, "extraction");
async function original(pages = 5) {
  const document = await PDFDocument.create();
  for (let page = 0; page < pages; page++) document.addPage();
  const bytes = await document.save();
  return { hash: createHash("sha256").update(bytes).digest("hex"), request: {
    mimeType: "application/pdf" as const, fileName: "synthetic.pdf", pageCount: pages,
    signedUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}` } };
}
function read(pageCount = 1): InvoiceExtractionResult {
  return { attempts: 1, model: config.pdfModel!, latencyMs: 10, usage: { costUsd: 0.01 },
    attemptTrace: [{ attempt: 1, kind: "success", model: config.pdfModel!, latencyMs: 10, costStatus: "KNOWN", usage: { costUsd: 0.01 } }],
    data: invoiceExtractionSchema.parse({ readConfidence: 0.9, documentKind: "FISCAL_INVOICE", markdown: "Material 10,00",
      totalAmount: "10", items: [{ lineNumber: 1, description: "Material", sourcePage: 1, sourceKind: "FISCAL_LINE",
        sourceText: "Material 10,00", totalAmount: "10", countsTowardDocumentTotal: true }],
      pageCoverage: Array.from({ length: pageCount }, (_, index) => ({ page: index + 1, complete: true,
        fieldsReviewed: true, requirementScope: "NONE" as const, requirementEvidence: null,
        sources: index === 0 ? [{ kind: "FISCAL_LINE" as const, count: 1 }] : [] })),
      itemCoverage: { status: "COMPLETE", extractedItemCount: 1, missingLineNumbers: [] } }) };
}
function merged(request: InvoiceExtractionRequest) {
  const data = read();
  data.data.items = request.visualWindows!.flatMap(window => window.data.items).map((item, index) => ({ ...item, lineNumber: index + 1 }));
  data.data.totalAmount = "10";
  const economic = data.data.items.filter(item => item.countsTowardDocumentTotal).map(item => item.lineNumber);
  data.data.pageCoverage = request.visualWindows!.flatMap(window => window.data.pageCoverage ?? []);
  data.data.itemCoverage = { ...data.data.itemCoverage, extractedItemCount: economic.length,
    firstLineNumber: economic[0] ?? null, lastLineNumber: economic.at(-1) ?? null };
  return data;
}

function denseWindow(): InvoiceExtractionResult {
  const result = read();
  result.data = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", totalAmount: "10", readConfidence: 0.9,
    markdown: "Despesa e controle denso", items: [
      { lineNumber: 1, description: "Material", sourceKind: "FISCAL_LINE", sourcePage: 1,
        sourceText: "Material total 10,00", totalAmount: "10", countsTowardDocumentTotal: true },
      { lineNumber: 2, description: "Controle parcial", sourceKind: "SHEET", sourcePage: 4,
        sourceText: "Controle A 15,00", totalAmount: "15", countsTowardDocumentTotal: false,
        evidenceObservations: [{ kind: "SHEET", amount: "15", page: 4, text: "Controle A 15,00" }] },
    ], pageCoverage: [1, 2, 3, 4].map(page => ({ page, complete: true, fieldsReviewed: true,
      requirementScope: "NONE" as const, requirementEvidence: null,
      sources: page === 1 ? [{ kind: "FISCAL_LINE" as const, count: 1 }]
        : page === 4 ? [{ kind: "SHEET" as const, count: 2 }] : [] })),
    itemCoverage: { status: "COMPLETE", extractedItemCount: 1, declaredItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [] } });
  result.qualityLimitation = { diagnostic: "evidence-source-not-extracted", message: "Fonte parcial",
    details: { page: 4, kind: "SHEET", expectedSources: 2, extractedSources: 1 } };
  return result;
}

function repairedDensePage(): InvoiceExtractionResult {
  const result = read();
  result.data = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", totalAmount: "33", readConfidence: 0.95,
    markdown: "Dois controles", items: [15, 18].map((amount, index) => ({ lineNumber: index + 1,
      description: `Controle ${index + 1}`, sourceKind: "SHEET" as const, sourcePage: 1,
      sourceText: `Controle ${index + 1} ${amount},00`, totalAmount: String(amount), countsTowardDocumentTotal: true,
      evidenceObservations: [{ kind: "SHEET" as const, amount: String(amount), page: 1,
        text: `Controle ${index + 1} ${amount},00` }] })),
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      sources: [{ kind: "SHEET", count: 2 }] }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 2, declaredItemCount: 2,
      firstLineNumber: 1, lastLineNumber: 2, missingLineNumbers: [] } });
  return result;
}

function repairedDenseDocumentFragment(): InvoiceExtractionResult {
  const result = repairedDensePage();
  result.data.itemCoverage = { ...result.data.itemCoverage, status: "INCOMPLETE",
    evidence: "A página original informa folha 1 de 2; a outra folha não faz parte desta releitura focal." };
  result.qualityLimitation = { diagnostic: "pdf-item-coverage-incomplete",
    message: "O documento completo possui outra folha.", details: { itemCoverage: result.data.itemCoverage } };
  return result;
}

function denseWindowWithTwoDeficitPages(): InvoiceExtractionResult {
  const result = denseWindow();
  result.data.pageCoverage![2].sources = [{ kind: "PAYMENT", count: 1 }];
  result.qualityLimitation = { diagnostic: "evidence-source-not-extracted", message: "Fonte parcial",
    details: { page: 3, kind: "PAYMENT", expectedSources: 1, extractedSources: 0 } };
  return result;
}

function repairedPaymentPage(): InvoiceExtractionResult {
  const result = read();
  result.data = invoiceExtractionSchema.parse({ documentKind: "PAYMENT_PROOF", totalAmount: "12", readConfidence: 0.95,
    markdown: "Pagamento 12,00", items: [{ lineNumber: 1, description: "Pagamento", sourceKind: "PAYMENT",
      sourcePage: 1, sourceText: "DÉBITO R$ 12,00", totalAmount: "12", countsTowardDocumentTotal: true }],
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      sources: [{ kind: "PAYMENT", count: 1 }] }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 1, firstLineNumber: 1,
      lastLineNumber: 1, missingLineNumbers: [] } });
  return result;
}

test("duas leituras simultâneas no máximo, checkpoint por etapa e consolidação sem original", async () => {
  const source = await original();
  let active = 0, peak = 0, calls = 0;
  const events: string[] = [];
  const client = new WindowedExtractionClient({ config, originalSha256: source.hash,
    checkpoint: async event => { events.push(`${event.stage}:${event.status}`); },
    createClient: () => ({ extractInvoice: async request => {
      calls++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10)); active--;
      if (request.visualWindows) {
        assert.equal(request.signedUrl, "");
        assert.deepEqual(request.visualWindows.map(window => window.pages), [[1, 2, 3, 4], [5]]);
        return merged(request);
      }
      return read(request.pageCount ?? 1);
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.equal(calls, 3); assert.equal(peak, 2);
  assert.equal(result.usage?.costUsd, 0.03);
  assert.equal(result.attempts, 3);
  assert.equal(events.filter(event => event.endsWith(":STARTED")).length, 3);
  assert.deepEqual(result.data.items.map(item => item.sourcePage), [1, 5]);
  assert.equal(result.data.itemCoverage.status, "COMPLETE");
  assert.equal(result.qualityLimitation, undefined);
});

test("blocos visuais transportam páginas completas em ordem e preservam checkpoints", async () => {
  const source = await original();
  const rendered: number[][] = [], events: WindowExtractionEvent[] = [];
  const visualConfig = { ...config, visualPdfWindows: true };
  const client = new WindowedExtractionClient({ config: visualConfig, originalSha256: source.hash,
    checkpoint: async event => { events.push(event); },
    renderPages: async (_bytes, pages, pageCount) => {
      assert.equal(pageCount, 5); rendered.push(pages); return pages.map(page => `synthetic-image-${page}`);
    },
    createClient: timeoutMs => ({ extractInvoice: async request => {
      assert.ok(timeoutMs > 45_000 && timeoutMs <= 180_000);
      if (request.visualWindows) return merged(request);
      assert.equal(request.signedUrl, "");
      assert.equal(request.pageImages?.length, request.pageCount);
      return read(request.pageCount ?? 1);
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.deepEqual(rendered, [[1, 2, 3, 4], [5]]);
  assert.equal(events.filter(event => event.checkpoint).length, 2);
  assert.deepEqual(result.data.items.map(item => item.sourcePage), [1, 5]);
});

test("déficit localizado relê só a página densa e fecha a cobertura sem duplicar a despesa", async () => {
  const source = await original();
  const rendered: number[][] = [], events: WindowExtractionEvent[] = [];
  const client = new WindowedExtractionClient({ config: { ...config, visualPdfWindows: true }, originalSha256: source.hash,
    checkpoint: async event => { events.push(event); },
    renderPages: async (_bytes, pages) => { rendered.push(pages); return pages.map(page => `page-${page}`); },
    createClient: () => ({ extractInvoice: async request => {
      if (request.visualWindows) return merged(request);
      if (request.pageImages?.[0] === "page-1") return denseWindow();
      if (request.pageImages?.[0] === "page-4") {
        assert.equal(request.pageReviewScope, "SOURCE_INVENTORY");
        return repairedDenseDocumentFragment();
      }
      return read(request.pageCount ?? 1);
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.equal(result.usage?.costUsd, 0.04);
  assert.equal(result.qualityLimitation, undefined);
  assert.equal(result.data.itemCoverage.status, "COMPLETE");
  assert.deepEqual(rendered, [[1, 2, 3, 4], [5], [4]]);
  assert.equal(events.some(event => event.stage === "PAGE_REPAIR" && event.status === "COMPLETED"), true);
  const repairedRows = result.data.items.filter(item => item.sourcePage === 4);
  assert.equal(repairedRows.length, 2);
  assert.deepEqual(repairedRows.map(item => item.countsTowardDocumentTotal), [false, false]);
});

test("limite 429 repete uma vez somente a página focal, no mesmo leitor", async () => {
  const source = await original();
  let repairCalls = 0;
  const events: WindowExtractionEvent[] = [];
  const client = new WindowedExtractionClient({ config: { ...config, visualPdfWindows: true }, originalSha256: source.hash,
    checkpoint: async event => { events.push(event); }, sleep: async () => {},
    renderPages: async (_bytes, pages) => pages.map(page => `page-${page}`),
    createClient: () => ({ extractInvoice: async request => {
      if (request.visualWindows) return merged(request);
      if (request.pageImages?.[0] === "page-1") return denseWindow();
      if (request.pageImages?.[0] === "page-4") {
        assert.equal(request.pageReviewScope, "SOURCE_INVENTORY");
        repairCalls++;
        if (repairCalls === 1) throw new OpenRouterClientError("provider", "synthetic rate limit", true, 429, 0,
          { attemptTrace: [{ attempt: 1, kind: "provider", model: config.pdfModel!, latencyMs: 1,
            status: 429, costStatus: "UNKNOWN" }] });
        return repairedDensePage();
      }
      return read(request.pageCount ?? 1);
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.equal(repairCalls, 2);
  assert.equal(result.data.itemCoverage.status, "COMPLETE");
  assert.equal(result.qualityLimitation, undefined);
  assert.equal(result.attemptTrace?.filter(attempt => attempt.diagnosticDetails?.stage === "PAGE_REPAIR").length, 2);
  assert.equal(events.some(event => event.stage === "PAGE_REPAIR" && event.status === "FAILED"), false);
  assert.equal(events.some(event => event.stage === "PAGE_REPAIR" && event.status === "COMPLETED"), true);
});

test("déficits em páginas distintas são reparados em sequência sem reler blocos íntegros", async () => {
  const source = await original();
  const rendered: number[][] = [];
  const client = new WindowedExtractionClient({ config: { ...config, visualPdfWindows: true }, originalSha256: source.hash,
    checkpoint: async () => {}, renderPages: async (_bytes, pages) => {
      rendered.push(pages); return pages.map(page => `page-${page}`);
    }, createClient: () => ({ extractInvoice: async request => {
      if (request.visualWindows) return merged(request);
      if (request.pageImages?.[0] === "page-1") return denseWindowWithTwoDeficitPages();
      if (request.pageImages?.[0] === "page-3") return repairedPaymentPage();
      if (request.pageImages?.[0] === "page-4") return repairedDenseDocumentFragment();
      return read(request.pageCount ?? 1);
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.equal(result.qualityLimitation, undefined);
  assert.equal(result.usage?.costUsd, 0.05);
  assert.deepEqual(rendered, [[1, 2, 3, 4], [5], [3], [4]]);
  assert.equal(result.data.items.some(item => item.sourcePage === 3 && item.sourceKind === "PAYMENT"), true);
  assert.equal(result.data.items.filter(item => item.sourcePage === 4).length, 2);
});

test("plano de associação rejeitado recebe uma única correção textual sem reler páginas", async () => {
  const source = await original();
  let consolidationCalls = 0, windowCalls = 0;
  const events: WindowExtractionEvent[] = [];
  const rejectedPlan = { headerWindow: 1, economicItemRefs: ["w1:i1"],
    groups: [{ refs: ["w1:i1", "w2:i1"], evidenceRefs: ["w1:i1", "w1:i1:o1"] }], parents: [] };
  const client = new WindowedExtractionClient({ config, originalSha256: source.hash,
    checkpoint: async event => { events.push(event); }, createClient: () => ({ extractInvoice: async request => {
      if (!request.visualWindows) { windowCalls++; return read(request.pageCount ?? 1); }
      consolidationCalls++;
      if (consolidationCalls === 1) throw new OpenRouterClientError("invalid-response", "synthetic plan", false,
        undefined, undefined, { diagnostic: "window-association-plan-invalid",
          diagnosticDetails: { reason: "Association evidence must cover every member." },
          recoveryDraft: JSON.stringify(rejectedPlan), usage: { costUsd: 0.01 },
          attemptTrace: [{ attempt: 1, kind: "invalid-response", model: config.pdfModel!, latencyMs: 1,
            costStatus: "KNOWN", usage: { costUsd: 0.01 } }] });
      assert.deepEqual(request.associationRepair, {
        previousPlan: rejectedPlan, reason: "Association evidence must cover every member.",
      });
      return merged(request);
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.equal(windowCalls, 2);
  assert.equal(consolidationCalls, 2);
  assert.equal(result.attempts, 4);
  assert.equal(result.usage?.costUsd, 0.04);
  assert.equal(events.filter(event => event.stage === "CONSOLIDATION" && event.status === "FAILED").length, 1);
  assert.equal(events.filter(event => event.stage === "CONSOLIDATION" && event.status === "COMPLETED").length, 1);
});

test("falha aguarda chamada em voo, não inicia novas janelas nem perde custo conhecido", async () => {
  const source = await original(13);
  let calls = 0, settled = false;
  const client = new WindowedExtractionClient({ config, originalSha256: source.hash, checkpoint: async () => {},
    createClient: () => ({ extractInvoice: async request => {
      const call = ++calls;
      if (call === 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new OpenRouterClientError("timeout", "synthetic", false, undefined, undefined,
          { attemptTrace: [{ attempt: 1, kind: "timeout", model: config.pdfModel!, latencyMs: 5, costStatus: "UNKNOWN" }] });
      }
      await new Promise(resolve => setTimeout(resolve, 20)); settled = true; return read(request.pageCount ?? 1);
    } }),
  });
  await assert.rejects(client.extractInvoice(source.request), error => {
    assert.ok(error instanceof OpenRouterClientError);
    assert.equal(error.usage?.costUsd, 0.01);
    assert.equal(error.attemptTrace?.length, 2);
    assert.equal(settled, true); return true;
  });
  assert.equal(calls, 2);
});

test("consolidação não apaga evidência e reavalia ressalva local contra o conjunto global", async () => {
  const windows = [{ pages: [1], data: read().data }];
  assert.equal(consolidationSourceIssue(windows, read().data), null);
  const inventedHeader = read().data; inventedHeader.totalAmount = "50";
  assert.equal(consolidationSourceIssue(windows, inventedHeader), "window-header-invented");
  const missingField = read().data;
  missingField.requiredFieldChecks.push({ field: "purpose", label: "Finalidade", page: 1, present: false,
    requiredByDocument: true, requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: "Obrigatório", evidence: "Campo vazio" });
  assert.equal(consolidationSourceIssue([{ pages: [1], data: missingField }], read().data), "window-required-fields-changed");
  const altered = read().data; altered.items[0].totalAmount = "12";
  assert.equal(consolidationSourceIssue(windows, altered), "window-source-dropped-or-rewritten");
  assert.throws(() => validateExtractionWindows(windows, 2), /every original page/);
  const source = await original();
  const client = new WindowedExtractionClient({ config, originalSha256: source.hash, checkpoint: async () => {},
    createClient: () => ({ extractInvoice: async request => {
      if (request.visualWindows) return merged(request);
      const result = read(request.pageCount ?? 1); result.qualityLimitation = { diagnostic: "incomplete", message: "synthetic", details: {} }; return result;
    } }),
  });
  const result = await client.extractInvoice(source.request);
  assert.equal(result.data.itemCoverage.status, "COMPLETE");
  assert.equal(result.qualityLimitation, undefined);
});

test("identidade divergente e plano acima do teto falham antes de qualquer chamada", async () => {
  let calls = 0;
  const source = await original(33);
  const client = new WindowedExtractionClient({ config, originalSha256: source.hash, checkpoint: async () => {},
    createClient: () => ({ extractInvoice: async () => { calls++; return read(); } }) });
  await assert.rejects(client.extractInvoice(source.request), /allowed request count/);
  await assert.rejects(client.extractInvoice({ ...source.request, signedUrl: "data:application/pdf;base64,QQ==" }), /identity changed/);
  assert.equal(calls, 0);
});

async function savedRead() {
  const source = await original();
  const saved: WindowExtractionEvent[] = [];
  const client = new WindowedExtractionClient({ config, originalSha256: source.hash,
    checkpoint: async event => { if (event.stage === "WINDOW" && event.status === "COMPLETED") saved.push(event); },
    createClient: () => ({ extractInvoice: async request => {
      if (request.visualWindows) throw new Error("synthetic consolidation failure");
      return read(request.pageCount ?? 1);
    } }),
  });
  await assert.rejects(client.extractInvoice(source.request));
  assert.equal(saved.length, 2);
  return { source, saved };
}

test("falha na consolidação retoma leituras salvas sem cobrar janelas de novo", async () => {
  const { source, saved } = await savedRead();
  const before = structuredClone(saved);
  let calls = 0;
  const result = await new WindowedExtractionClient({ config, originalSha256: source.hash, savedWindows: saved,
    checkpoint: async () => {}, createClient: () => ({ extractInvoice: async request => {
      calls++; assert.ok(request.visualWindows); assert.equal(request.signedUrl, ""); return merged(request);
    } }),
  }).extractInvoice(source.request);
  assert.equal(calls, 1); assert.equal(result.attempts, 1);
  assert.equal(result.usage?.costUsd, 0.01);
  assert.deepEqual(result.data.items.map(item => item.sourcePage), [1, 5]);
  assert.deepEqual(saved, before);
});

test("recuperação parcial lê somente a janela que não tem checkpoint", async () => {
  const { source, saved } = await savedRead();
  let visualCalls = 0;
  const result = await new WindowedExtractionClient({ config, originalSha256: source.hash,
    savedWindows: saved.filter(event => event.pages[0] === 1), checkpoint: async () => {},
    createClient: () => ({ extractInvoice: async request => {
      if (request.visualWindows) return merged(request);
      visualCalls++; assert.equal(request.pageCount, 1); return read(request.pageCount ?? 1);
    } }),
  }).extractInvoice(source.request);
  assert.equal(visualCalls, 1); assert.equal(result.usage?.costUsd, 0.02);
});

test("cache incompleto, adulterado, legado ou de outro leitor falha antes de chamadas", async () => {
  const { source, saved } = await savedRead();
  const first = saved.find(event => event.pages[0] === 1)!;
  const invalid = [
    [{ ...first, originalSha256: "0".repeat(64) }],
    [{ ...first, pages: [2, 3, 4, 5] }],
    [first, first],
    [{ ...first, checkpoint: undefined }],
    [{ ...first, checkpoint: { ...first.checkpoint, data: {} } }],
    [{ ...first, checkpoint: { ...first.checkpoint, fingerprint: "0".repeat(64) } }],
    [{ ...first, status: "FAILED" }],
  ];
  let calls = 0;
  for (const savedWindows of invalid) {
    const client = new WindowedExtractionClient({ config, originalSha256: source.hash, savedWindows,
      checkpoint: async () => {}, createClient: () => ({ extractInvoice: async () => { calls++; return read(); } }) });
    await assert.rejects(client.extractInvoice(source.request));
  }
  await assert.rejects(new WindowedExtractionClient({ config: { ...config, maxTokens: config.maxTokens + 1 },
    originalSha256: source.hash, savedWindows: saved, checkpoint: async () => {},
    createClient: () => ({ extractInvoice: async () => { calls++; return read(); } }),
  }).extractInvoice(source.request));
  assert.equal(calls, 0);
});

test("checkpoint com ressalva local não contamina consolidação global comprovadamente completa", async () => {
  const { source, saved } = await savedRead();
  saved[0].checkpoint!.qualityLimitation = { diagnostic: "synthetic-gap", message: "Fonte parcial", details: {} };
  const result = await new WindowedExtractionClient({ config, originalSha256: source.hash, savedWindows: saved,
    checkpoint: async () => {}, createClient: () => ({ extractInvoice: async request => merged(request) }),
  }).extractInvoice(source.request);
  assert.equal(result.data.itemCoverage.status, "COMPLETE");
  assert.equal(result.qualityLimitation, undefined);
});

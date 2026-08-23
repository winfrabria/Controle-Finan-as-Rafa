import assert from "node:assert/strict";
import test from "node:test";

import { HARNESS_PDF_MODEL } from "@/lib/audit-harness/versions";
import {
  invoiceExtractionSchema,
  parseInvoiceExtractionPayload,
  type InvoiceExtraction,
} from "@/lib/integrations/openrouter/extraction-contract";
import {
  getInvoiceExtractionLimitation,
  OpenRouterClientError,
  OpenRouterInvoiceExtractionClient,
} from "./client";

const validExtraction: InvoiceExtraction = {
  currency: "BRL",
  documentKind: "FISCAL_INVOICE",
  documentNumber: "SYNTH-001",
  issuedAt: "2026-07-31",
  itemCoverage: {
    status: "COMPLETE",
    declaredItemCount: 1,
    extractedItemCount: 1,
    firstLineNumber: 1,
    lastLineNumber: 1,
    missingLineNumbers: [],
    evidence: "Primeira e última linha conferidas.",
  },
  items: [
    {
      code: null,
      countsTowardDocumentTotal: true,
      description: "CAFÉ DA MANHÃ",
      documentGroup: null,
      documentRole: "LINE_ITEM",
      evidenceObservations: [],
      lineNumber: 1,
      quantity: "164.07",
      totalAmount: "1148.50",
      unit: "UN",
      unitPrice: "7.00",
    },
  ],
  markdown: "NF-e sintética com total de R$ 1.148,50.",
  readConfidence: 0.99,
  requiredFieldChecks: [],
  supplierName: "Fornecedor Sintético Ltda.",
  supplierTaxId: null,
  totalAmount: "1148.50",
  warnings: [],
};

function successResponse(
  model: string,
  options: {
    completionTokens?: number;
    costUsd?: number;
    extraction?: unknown;
    finishReason?: string | null;
  } = {},
) {
  const completionTokens = options.completionTokens ?? 10;
  const promptTokens = 20;
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: options.finishReason ?? "stop",
          message: {
            content: JSON.stringify(options.extraction ?? validExtraction),
          },
        },
      ],
      model,
      provider: "test-provider",
      usage: {
        completion_tokens: completionTokens,
        cost: options.costUsd,
        prompt_tokens: promptTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

test("normaliza formatos monetários e campos ausentes sem inventar conteúdo", () => {
  const parsed = invoiceExtractionSchema.parse({
    documentNumber: "075",
    issuedAt: "01/06/2026",
    items: [
      {
        description: "Despesa de alimentação",
        lineNumber: 1,
        totalAmount: "R$ 1.148,50",
      },
    ],
    markdown: "Página 1 - despesa de alimentação.",
    readConfidence: 0.8,
    supplierName: null,
    totalAmount: 1148.5,
  });

  assert.equal(parsed.issuedAt, "2026-06-01");
  assert.equal(parsed.totalAmount, "1148.5");
  assert.equal(parsed.items[0]?.totalAmount, "1148.50");
  assert.equal(parsed.items[0]?.quantity, null);
  assert.equal(parsed.itemCoverage.status, "UNKNOWN");
  assert.deepEqual(parsed.warnings, []);
});

test("normaliza cobertura parcial e impede que uma contagem declarada maior pareça completa", () => {
  const parsed = parseInvoiceExtractionPayload({
    documentKind: "FISCAL_INVOICE",
    documentNumber: "352564",
    issuedAt: "2026-08-01",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 50,
      extractedItemCount: 50,
      firstLineNumber: 1,
      lastLineNumber: 44,
      missingLineNumbers: [45, 46, 47, 48, 49, 50],
      evidence: "Tabela continua após a última linha extraída.",
    },
    items: Array.from({ length: 44 }, (_, index) => ({
      countsTowardDocumentTotal: true,
      description: `Produto ${index + 1}`,
      totalAmount: "10.00",
    })),
    markdown: "Nota com tabela de cinquenta produtos.",
    readConfidence: 0.9,
    supplierName: "Fornecedor",
    supplierTaxId: null,
    totalAmount: "500.00",
    warnings: [],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.itemCoverage.status, "INCOMPLETE");
  assert.equal(parsed.data.itemCoverage.declaredItemCount, 50);
  assert.equal(parsed.data.itemCoverage.extractedItemCount, 44);
  assert.deepEqual(parsed.data.itemCoverage.missingLineNumbers, [45, 46, 47, 48, 49, 50]);
});

test("recupera desvios estruturais seguros sem uma nova chamada", () => {
  const parsed = parseInvoiceExtractionPayload({
    currency: "R$",
    documentNumber: null,
    issuedAt: null,
    items: [
      {
        code: null,
        description: "Despesa 1",
        lineNumber: 1,
        quantity: null,
        totalAmount: "10,00",
        unit: null,
        unitPrice: null,
      },
      {
        code: null,
        description: "Despesa 2",
        lineNumber: 1,
        quantity: null,
        totalAmount: "20,00",
        unit: null,
        unitPrice: null,
      },
    ],
    markdown: "Ficha de reembolso.",
    readConfidence: "92",
    supplierName: null,
    supplierTaxId: null,
    totalAmount: "30,00",
    warnings: null,
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.currency, "BRL");
  assert.equal(parsed.data.readConfidence, 0.92);
  assert.deepEqual(
    parsed.data.items.map((item) => item.lineNumber),
    [1, 2],
  );
  assert.deepEqual(parsed.data.warnings, []);
  assert.equal(parsed.data.documentKind, "REIMBURSEMENT");
  assert.deepEqual(parsed.data.items[0]?.evidenceObservations, []);
  assert.equal(parsed.data.items[0]?.documentRole, "LINE_ITEM");
  assert.equal(parsed.data.items[0]?.documentGroup, null);
  assert.deepEqual(parsed.data.requiredFieldChecks, []);
});

test("normaliza papéis documentais e campos obrigatórios sem depender de uma NF específica", () => {
  const parsed = parseInvoiceExtractionPayload({
    currency: "BRL",
    documentKind: "COMPOSITE",
    documentNumber: null,
    issuedAt: null,
    items: [
      {
        description: "Cobrança consolidada",
        document_group: "Lote julho",
        document_role: "BOLETO",
        totalAmount: "950.00",
      },
      {
        description: "Documento fiscal A-71",
        document_group: "Lote julho",
        role: "INVOICE",
        totalAmount: "300.00",
      },
    ],
    markdown: "Cobrança e documentos fiscais de suporte.",
    readConfidence: 0.9,
    required_field_checks: [
      {
        field: "approver",
        label: "Aprovador",
        required: true,
        filled: false,
        page: 1,
        text: "Todos os campos são obrigatórios.",
      },
    ],
    supplierName: null,
    supplierTaxId: null,
    totalAmount: "950.00",
    warnings: [],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(
    parsed.data.items.map((item) => item.documentRole),
    ["AGGREGATE_PAYMENT", "SUPPORTING_DOCUMENT"],
  );
  assert.equal(parsed.data.items[0]?.documentGroup, "Lote julho");
  assert.deepEqual(parsed.data.requiredFieldChecks, [
    {
      evidence: "Todos os campos são obrigatórios.",
      field: "approver",
      label: "Aprovador",
      page: 1,
      present: false,
      requiredByDocument: true,
    },
  ]);
});

test("preserva separadamente ficha, venda e pagamento em documento composto", () => {
  const parsed = parseInvoiceExtractionPayload({
    currency: "BRL",
    documentKind: "REEMBOLSO",
    documentNumber: null,
    issuedAt: "10/08/2026",
    items: [
      {
        code: "7",
        countsTowardDocumentTotal: true,
        description: "Despesa sintética",
        evidenceObservations: [
          { kind: "FICHA", documentGroup: "grupo-sintetico-7", amount: "18,00", date: "10/08/2026", page: 3 },
          { kind: "CARTAO", document_group: "grupo-sintetico-7", amount: "28,00", date: "10/08/2026", page: 3 },
        ],
        lineNumber: 7,
        quantity: "1",
        totalAmount: "18,00",
        unit: null,
        unitPrice: "18,00",
      },
    ],
    markdown: "Ficha sintética de reembolso — item 7.",
    readConfidence: 0.98,
    supplierName: null,
    supplierTaxId: null,
    totalAmount: "180,00",
    warnings: [],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.documentKind, "REIMBURSEMENT");
  assert.deepEqual(
    parsed.data.items[0]?.evidenceObservations.map((entry) => [
      entry.kind,
      entry.amount,
    ]),
    [
      ["SHEET", "18.00"],
      ["PAYMENT", "28.00"],
    ],
  );
  assert.deepEqual(
    parsed.data.items[0]?.evidenceObservations.map((entry) => entry.documentGroup),
    ["grupo-sintetico-7", "grupo-sintetico-7"],
  );
});

test("aceita envelope comum e termina leitura vazia como baixa confiança", () => {
  const parsed = parseInvoiceExtractionPayload({
    result: {
      document_number: 1322,
      issued_at: "2026-07-31T10:30:00Z",
      items: null,
      read_confidence: null,
      supplier_name: "Fornecedor teste",
      total_amount: null,
    },
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.documentNumber, "1322");
  assert.equal(parsed.data.issuedAt, "2026-07-31");
  assert.equal(parsed.data.readConfidence, 0);
  assert.equal(parsed.data.items.length, 0);
  assert.match(parsed.data.markdown, /Nenhum conteúdo textual confiável/i);
});

test("PDF usa o modelo estável configurado e aceita a reconciliação por camada", async () => {
  const requestedModels: string[] = [];
  let requestedPayload: Record<string, unknown> | undefined;
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      requestedPayload = payload;
      requestedModels.push(payload.model);
      return successResponse(payload.model);
    },
    maxAttempts: 2,
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  const result = await client.extractInvoice({
    fileName: "NF 1322.pdf",
    mimeType: "application/pdf",
    signedUrl: "https://storage.test/nf-1322.pdf?token=redacted",
  });

  assert.deepEqual(requestedModels, [HARNESS_PDF_MODEL]);
  assert.equal(result.attempts, 1);
  assert.equal(result.data.items[0]?.countsTowardDocumentTotal, true);
  assert.deepEqual(requestedPayload?.plugins, [
    { id: "file-parser", pdf: { engine: "native" } },
    { id: "response-healing" },
  ]);
  assert.deepEqual(requestedPayload?.provider, { require_parameters: true });
  assert.equal(requestedPayload?.max_tokens, 8_192);
  assert.equal("temperature" in (requestedPayload ?? {}), false);
});

test("não aceita silenciosamente PDF que atinge exatamente 8192 tokens e relê o original", async () => {
  let calls = 0;
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      calls += 1;
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return successResponse(HARNESS_PDF_MODEL, {
        completionTokens: 8_192,
        costUsd: 0.02,
      });
    },
    maxAttempts: 2,
    maxTokens: 8_192,
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "documento-longo.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/documento-longo.pdf?token=redacted",
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenRouterClientError);
      assert.equal(error.kind, "invalid-response");
      assert.equal(error.diagnostic, "completion-token-limit");
      assert.equal(error.attempts, 2);
      assert.equal(error.usage?.completionTokens, 16_384);
      assert.equal(error.usage?.costUsd, 0.04);
      assert.ok(error.latencyMs !== undefined);
      return true;
    },
  );

  assert.equal(calls, 2);
  for (const payload of payloads) {
    assert.match(JSON.stringify(payload.messages), /file_data/);
    assert.deepEqual(payload.plugins, [
      { id: "file-parser", pdf: { engine: "native" } },
      { id: "response-healing" },
    ]);
  }
});

test("detecta finish_reason length antes de tentar reparar o JSON truncado", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (payloads.length === 2) return successResponse(HARNESS_PDF_MODEL);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: "{\"items\":[{\"lineNumber\":1" },
            },
          ],
          model: HARNESS_PDF_MODEL,
          provider: "test-provider",
          usage: {
            completion_tokens: 8_192,
            cost: 0.01,
            prompt_tokens: 20,
            total_tokens: 8_212,
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    },
    maxAttempts: 2,
    maxTokens: 8_192,
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  const result = await client.extractInvoice({
    fileName: "documento-truncado.pdf",
    mimeType: "application/pdf",
    signedUrl: "https://storage.test/documento-truncado.pdf?token=redacted",
  });

  assert.equal(result.attempts, 2);
  assert.equal(payloads.length, 2);
  assert.match(JSON.stringify(payloads[1]?.messages), /file_data/);
  assert.doesNotMatch(JSON.stringify(payloads[1]?.messages), /extraction_draft/);
});

test("rejeita cobertura COMPLETE com seleção explícita totalmente vazia", () => {
  const limitation = getInvoiceExtractionLimitation(
    {
      ...validExtraction,
      itemCoverage: {
        ...validExtraction.itemCoverage,
        extractedItemCount: 1,
      },
      items: validExtraction.items.map((item) => ({
        ...item,
        countsTowardDocumentTotal: false,
      })),
    },
    "application/pdf",
  );

  assert.equal(limitation?.diagnostic, "pdf-item-coverage-inconsistent");
  assert.equal(limitation?.details.selectedLayerCount, 0);
});

test("rejeita PDF composto sem camada econômica explícita", () => {
  const limitation = getInvoiceExtractionLimitation(
    {
      ...validExtraction,
      documentKind: "REIMBURSEMENT",
      itemCoverage: {
        ...validExtraction.itemCoverage,
        declaredItemCount: 3,
        extractedItemCount: 3,
        firstLineNumber: 1,
        lastLineNumber: 3,
      },
      items: [1, 2, 3].map((lineNumber) => ({
        ...validExtraction.items[0],
        countsTowardDocumentTotal: undefined,
        documentGroup: "evento-sem-camada",
        evidenceObservations: [
          {
            amount: "20.00",
            date: "2026-07-31",
            documentGroup: "evento-sem-camada",
            kind: lineNumber === 1 ? "SHEET" as const : lineNumber === 2 ? "RECEIPT" as const : "PAYMENT" as const,
            label: `Camada ${lineNumber}`,
            page: lineNumber,
            text: "R$ 20,00",
          },
        ],
        lineNumber,
      })),
    },
    "application/pdf",
  );

  assert.equal(limitation?.diagnostic, "pdf-item-coverage-inconsistent");
  assert.equal(limitation?.details.hasCompositeStructure, true);
  assert.equal(limitation?.details.hasExplicitLayerSelection, false);
});

test("rejeita PDF com itens quando qualquer linha omite a camada econômica", () => {
  const limitation = getInvoiceExtractionLimitation(
    {
      ...validExtraction,
      documentKind: "FISCAL_INVOICE",
      items: validExtraction.items.map((item) => ({
        ...item,
        countsTowardDocumentTotal: undefined,
      })),
      markdown: "Ficha de reembolso, recibo e comprovante de pagamento.",
    },
    "application/pdf",
  );

  assert.equal(limitation?.diagnostic, "pdf-item-coverage-inconsistent");
  assert.equal(limitation?.details.hasCompleteExplicitLayerSelection, false);
});

test("rejeita PDF composto declarado completo sem nenhuma linha extraída", () => {
  const limitation = getInvoiceExtractionLimitation(
    {
      ...validExtraction,
      documentKind: "REIMBURSEMENT",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: null,
        extractedItemCount: 0,
        firstLineNumber: null,
        lastLineNumber: null,
        missingLineNumbers: [],
        evidence: "Documento lido.",
      },
      items: [],
    },
    "application/pdf",
  );

  assert.equal(limitation?.diagnostic, "pdf-item-coverage-inconsistent");
  assert.equal(limitation?.details.hasCompositeStructure, true);
});

test("rejeita PDF fiscal com total mas sem nenhuma linha extraída", () => {
  const limitation = getInvoiceExtractionLimitation(
    {
      ...validExtraction,
      documentKind: "FISCAL_INVOICE",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: null,
        extractedItemCount: 0,
        firstLineNumber: null,
        lastLineNumber: null,
        missingLineNumbers: [],
        evidence: "Documento lido.",
      },
      items: [],
    },
    "application/pdf",
  );

  assert.equal(limitation?.diagnostic, "pdf-item-coverage-inconsistent");
});

test("rejeita lacuna intermediária omitida em cobertura declarada COMPLETE", () => {
  const limitation = getInvoiceExtractionLimitation(
    {
      ...validExtraction,
      itemCoverage: {
        ...validExtraction.itemCoverage,
        declaredItemCount: 2,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 3,
      },
      items: [
        validExtraction.items[0],
        {
          ...validExtraction.items[0],
          description: "Linha três",
          lineNumber: 3,
        },
      ],
    },
    "application/pdf",
  );

  assert.equal(limitation?.diagnostic, "pdf-item-coverage-inconsistent");
  assert.deepEqual(limitation?.details.unreportedInternalGaps, [2]);
});

test("rejeita cobertura UNKNOWN em PDF mesmo quando o JSON é válido", async () => {
  const extraction = {
    ...validExtraction,
    documentKind: "COMPOSITE",
    itemCoverage: {
      status: "UNKNOWN",
      declaredItemCount: null,
      extractedItemCount: 2,
      firstLineNumber: null,
      lastLineNumber: null,
      missingLineNumbers: [],
      evidence: null,
    },
    items: [
      {
        ...validExtraction.items[0],
        evidenceObservations: [
          { kind: "SHEET", amount: "10.00", page: null },
        ],
        totalAmount: "10.00",
      },
      {
        ...validExtraction.items[0],
        description: "Comprovante sintético",
        evidenceObservations: [
          { kind: "PAYMENT", amount: "10.00" },
        ],
        lineNumber: 2,
        totalAmount: "10.00",
      },
    ],
  };
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () =>
      successResponse(HARNESS_PDF_MODEL, { extraction }),
    maxAttempts: 1,
    model: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "documento-composto.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/documento-composto.pdf?token=redacted",
    }),
    (error: unknown) =>
      error instanceof OpenRouterClientError &&
      error.kind === "invalid-response" &&
      error.diagnostic === "pdf-item-coverage-unknown",
  );
});

test("rejeita páginas nulas ou ausentes em evidências de PDF composto", async () => {
  const extraction = {
    ...validExtraction,
    documentKind: "REIMBURSEMENT",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 2,
      firstLineNumber: 1,
      lastLineNumber: 2,
      missingLineNumbers: [],
      evidence: "Duas linhas conferidas.",
    },
    items: [
      {
        ...validExtraction.items[0],
        evidenceObservations: [
          { kind: "SHEET", amount: "10.00", page: null },
        ],
        totalAmount: "10.00",
      },
      {
        ...validExtraction.items[0],
        description: "Pagamento sintético",
        evidenceObservations: [
          { kind: "PAYMENT", amount: "10.00" },
        ],
        lineNumber: 2,
        totalAmount: "10.00",
      },
    ],
  };
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () =>
      successResponse(HARNESS_PDF_MODEL, { extraction }),
    maxAttempts: 1,
    model: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "reembolso.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
    }),
    (error: unknown) =>
      error instanceof OpenRouterClientError &&
      error.kind === "invalid-response" &&
      error.diagnostic === "pdf-evidence-page-missing",
  );
});

test("rejeita cobertura parcial antes de liberar PDF para auditoria", async () => {
  const extraction = {
    ...validExtraction,
    itemCoverage: {
      status: "INCOMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 1,
      firstLineNumber: 1,
      lastLineNumber: 1,
      missingLineNumbers: [2],
      evidence: "Segunda linha não extraída.",
    },
  };
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () =>
      successResponse(HARNESS_PDF_MODEL, { extraction }),
    maxAttempts: 1,
    model: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "tabela-parcial.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/tabela-parcial.pdf?token=redacted",
    }),
    (error: unknown) =>
      error instanceof OpenRouterClientError &&
      error.kind === "invalid-response" &&
      error.diagnostic === "pdf-item-coverage-incomplete",
  );
});

test("rejeita cobertura declarada completa com contagem inconsistente", async () => {
  const extraction = {
    ...validExtraction,
    itemCoverage: {
      ...validExtraction.itemCoverage,
      declaredItemCount: 2,
      extractedItemCount: 2,
      lastLineNumber: 2,
    },
  };
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () =>
      successResponse(HARNESS_PDF_MODEL, { extraction }),
    maxAttempts: 1,
    model: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "native",
    reasoningEffort: "high",
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "contagem-inconsistente.pdf",
      mimeType: "application/pdf",
      signedUrl:
        "https://storage.test/contagem-inconsistente.pdf?token=redacted",
    }),
    (error: unknown) =>
      error instanceof OpenRouterClientError &&
      error.kind === "invalid-response" &&
      error.diagnostic === "pdf-item-coverage-inconsistent",
  );
});

test("resposta inválida é reconstruída uma vez antes de falhar o job", async () => {
  let calls = 0;
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      calls += 1;
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (calls === 2) return successResponse(HARNESS_PDF_MODEL);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{json-incompleto" } }],
          model: HARNESS_PDF_MODEL,
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    },
    maxAttempts: 2,
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "mistral-ocr",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  const result = await client.extractInvoice({
    fileName: "reembolso.pdf",
    mimeType: "application/pdf",
    signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
  });

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.deepEqual(payloads[1]?.plugins, [{ id: "response-healing" }]);
  assert.match(JSON.stringify(payloads[1]?.messages), /extraction_draft/);
  assert.doesNotMatch(JSON.stringify(payloads[1]?.messages), /file_data/);
});

test("reconstrói JSON com o OCR já obtido sem reler o PDF", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      if (payloads.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  annotations: [
                    {
                      type: "file",
                      file: {
                        hash: "pdf-hash",
                        content: [
                          {
                            type: "text",
                            text: "Página 1 - NF 1322 - total R$ 1.148,50",
                          },
                        ],
                      },
                    },
                  ],
                  content: "{json-incompleto",
                },
              },
            ],
            model: HARNESS_PDF_MODEL,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return successResponse(HARNESS_PDF_MODEL);
    },
    maxAttempts: 2,
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "mistral-ocr",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  const result = await client.extractInvoice({
    fileName: "reembolso.pdf",
    mimeType: "application/pdf",
    signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
  });

  assert.equal(result.attempts, 2);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0]?.plugins, [
    { id: "file-parser", pdf: { engine: "mistral-ocr" } },
    { id: "response-healing" },
  ]);
  assert.deepEqual(payloads[1]?.plugins, [{ id: "response-healing" }]);
  assert.match(JSON.stringify(payloads[1]?.messages), /NF 1322/);
  assert.doesNotMatch(JSON.stringify(payloads[1]?.messages), /file_data/);
});

test("mantém OCR parcial em estado seguro quando também falha a reconstrução estruturada", async () => {
  let calls = 0;
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  annotations: [
                    {
                      type: "file",
                      file: {
                        hash: "reembolso-hash",
                        content: [
                          {
                            type: "text",
                            text: `Ficha de reembolso com comprovantes.\n${"Despesa R$ 25,00. ".repeat(12)}`,
                          },
                        ],
                      },
                    },
                  ],
                  content: "{json-incompleto",
                },
              },
            ],
            model: HARNESS_PDF_MODEL,
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ainda não é JSON" } }],
          model: HARNESS_PDF_MODEL,
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    },
    maxAttempts: 2,
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "mistral-ocr",
    reasoningEffort: "max",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "reembolso.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenRouterClientError);
      assert.equal(error.kind, "invalid-response");
      assert.equal(error.diagnostic, "ocr-only-partial");
      assert.equal(error.attempts, 2);
      assert.equal(error.provider, "mistral-ocr");
      return true;
    },
  );

  assert.equal(calls, 2);
});

test("classifica como timeout quando o prazo expira durante a leitura do corpo", async () => {
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () =>
      ({
        headers: new Headers(),
        json: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new SyntaxError("body interrupted");
        },
        ok: true,
      }) as unknown as Response,
    maxAttempts: 1,
    model: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
    pdfEngine: "mistral-ocr",
    reasoningEffort: "max",
    timeoutMs: 5,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "reembolso.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
    }),
    (error: unknown) =>
      error instanceof OpenRouterClientError && error.kind === "timeout",
  );
});

test("PDF experimental incompatível recua para Terra na mesma execução", async () => {
  const requestedModels: string[] = [];
  const experimentalModel = "google/gemini-3.6-flash";
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(payload.model);
      if (payload.model === experimentalModel) {
        return new Response(
          JSON.stringify({ error: { message: "PDF parser unavailable" } }),
          { headers: { "content-type": "application/json" }, status: 400 },
        );
      }
      return successResponse(payload.model);
    },
    maxAttempts: 2,
    model: experimentalModel,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: experimentalModel,
    pdfEngine: "native",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  const result = await client.extractInvoice({
    fileName: "reembolso.pdf",
    mimeType: "application/pdf",
    signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
  });

  assert.deepEqual(requestedModels, [experimentalModel, HARNESS_PDF_MODEL]);
  assert.equal(result.attempts, 2);
  assert.equal(result.model, HARNESS_PDF_MODEL);
});

test("preserva HTTP 402 como falha não repetível de saldo", async () => {
  let calls = 0;
  const primaryModel = "google/gemini-3.6-flash";
  const client = new OpenRouterInvoiceExtractionClient({
    apiKey: "test-key",
    fetchImplementation: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: { message: "This request requires at least $0.50 in balance for files" },
        }),
        { headers: { "content-type": "application/json" }, status: 402 },
      );
    },
    maxAttempts: 2,
    maxTokens: 8_192,
    model: primaryModel,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: primaryModel,
    pdfEngine: "mistral-ocr",
    reasoningEffort: "high",
    sleep: async () => undefined,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    client.extractInvoice({
      fileName: "reembolso.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
    }),
    (error: unknown) =>
      error instanceof OpenRouterClientError &&
      error.status === 402 &&
      error.retryable === false &&
      /\$0\.50/.test(error.message),
  );
  assert.equal(calls, 1);
});

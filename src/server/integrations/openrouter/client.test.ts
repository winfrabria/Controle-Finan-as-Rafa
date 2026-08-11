import assert from "node:assert/strict";
import test from "node:test";

import { HARNESS_PDF_MODEL } from "@/lib/audit-harness/versions";
import {
  invoiceExtractionSchema,
  parseInvoiceExtractionPayload,
} from "@/lib/integrations/openrouter/extraction-contract";
import {
  OpenRouterClientError,
  OpenRouterInvoiceExtractionClient,
} from "./client";

const validExtraction = {
  currency: "BRL",
  documentNumber: "1322",
  issuedAt: "2026-07-31",
  items: [
    {
      code: null,
      countsTowardDocumentTotal: true,
      description: "CAFÉ DA MANHÃ",
      lineNumber: 1,
      quantity: "164.07",
      totalAmount: "1148.50",
      unit: "UN",
      unitPrice: "7.00",
    },
  ],
  markdown: "NF-e 1322 com total de R$ 1.148,50.",
  readConfidence: 0.99,
  supplierName: "NEURACY ARGOLO COSTA",
  supplierTaxId: null,
  totalAmount: "1148.50",
  warnings: [],
};

function successResponse(model: string) {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify(validExtraction) } },
      ],
      model,
      provider: "test-provider",
      usage: { completion_tokens: 10, prompt_tokens: 20, total_tokens: 30 },
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
  assert.deepEqual(parsed.warnings, []);
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

test("preserva OCR utilizável quando também falha a reconstrução estruturada", async () => {
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

  const result = await client.extractInvoice({
    fileName: "reembolso.pdf",
    mimeType: "application/pdf",
    signedUrl: "https://storage.test/reembolso.pdf?token=redacted",
  });

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.provider, "mistral-ocr");
  assert.equal(result.data.items.length, 0);
  assert.equal(result.data.readConfidence, 0.65);
  assert.match(result.data.markdown, /Ficha de reembolso/);
  assert.match(result.data.warnings[0] ?? "", /OCR integral/);
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
    model: HARNESS_PDF_MODEL,
    pdfFallbackModel: HARNESS_PDF_MODEL,
    pdfModel: HARNESS_PDF_MODEL,
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

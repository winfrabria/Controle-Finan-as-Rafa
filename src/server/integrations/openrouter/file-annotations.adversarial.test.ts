import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenRouterInvoiceExtractionClient,
} from "./client";

const validExtraction = {
  currency: "BRL",
  documentKind: "OTHER",
  documentNumber: null,
  issuedAt: null,
  items: [],
  markdown: "Documento sintético legível com conteúdo suficiente.",
  readConfidence: 0.9,
  requiredFieldChecks: [],
  supplierName: null,
  supplierTaxId: null,
  totalAmount: null,
  warnings: [],
};

function successfulResponse(model: string) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validExtraction) } }],
      model,
      provider: "test-provider",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

for (const metadataLocation of ["metadata", "openrouter_metadata"] as const) {
  test(`file_annotations no topo de ${metadataLocation} deve ser reutilizado no Sol`, async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const client = new OpenRouterInvoiceExtractionClient({
      apiKey: "test-key",
      fallbackModel: "openai/gpt-5.6-sol",
      fetchImplementation: async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        payloads.push(payload);
        if (payloads.length === 1) {
          return new Response(
            JSON.stringify({
              error: { code: "PROVIDER_BAD_REQUEST", message: "unsupported parameter" },
              [metadataLocation]: {
                file_annotations: [
                  {
                    type: "file",
                    file: {
                      hash: `${metadataLocation}-hash`,
                      content: [{ type: "text", text: "OCR top-level recuperado." }],
                    },
                  },
                ],
              },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        return successfulResponse(String(payload.model));
      },
      maxAttempts: 2,
      model: "openai/gpt-5.6-terra",
      pdfEngine: "mistral-ocr",
      reasoningEffort: "high",
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });

    await client.extractInvoice({
      fileName: "documento.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/documento.pdf?token=redacted",
    });

    assert.equal(payloads.length, 2);
    assert.doesNotMatch(JSON.stringify(payloads[1]?.messages), /file_data/);
    assert.match(JSON.stringify(payloads[1]?.messages), /OCR top-level recuperado/);
  });
}

for (const malformedAnnotations of [null, {}, "not-an-array"] as const) {
  test(`file_annotations não-array (${String(malformedAnnotations)}) não quebra o fallback`, async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const client = new OpenRouterInvoiceExtractionClient({
      apiKey: "test-key",
      fallbackModel: "openai/gpt-5.6-sol",
      fetchImplementation: async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        payloads.push(payload);
        if (payloads.length === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: "PROVIDER_BAD_REQUEST",
                message: "unsupported parameter",
                metadata: { file_annotations: malformedAnnotations },
              },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        return successfulResponse(String(payload.model));
      },
      maxAttempts: 2,
      model: "openai/gpt-5.6-terra",
      pdfEngine: "mistral-ocr",
      reasoningEffort: "high",
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });

    const result = await client.extractInvoice({
      fileName: "documento.pdf",
      mimeType: "application/pdf",
      signedUrl: "https://storage.test/documento.pdf?token=redacted",
    });

    assert.equal(result.attempts, 2);
    assert.doesNotMatch(JSON.stringify(payloads[1]?.messages), /OCR top-level/);
    assert.match(JSON.stringify(payloads[1]?.messages), /file_data/);
  });
}

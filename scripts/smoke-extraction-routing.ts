import "dotenv/config";

import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { OpenRouterInvoiceExtractionClient } from "../src/server/integrations/openrouter/client";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";

/**
 * Opt-in, small paid smoke using the real extraction client and a PDF created
 * only in memory. No user document, database write, or storage upload is used.
 * Never print the request, PDF, API key, OCR, prompts or provider response.
 */
async function main() {
  if (!process.argv.includes("--online")) {
    console.info("Smoke não executado. Use --online para uma extração paga de PDF sintético, sem dados de usuário ou gravação no banco.");
    return;
  }

  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const lines = [
    "RECIBO SINTETICO PARA TESTE TECNICO",
    "Este documento e ficticio e nao possui valor fiscal.",
    "Numero: QA-SMOKE",
    "Fornecedor: Fornecedor Sintetico de Teste",
    "Data: 15/01/2026",
    "Item | Descricao | Quantidade | Preco unitario | Total",
    "1 | Caderno de anotacoes | 2 | R$ 7,50 | R$ 15,00",
    "TOTAL GERAL: R$ 15,00",
  ];
  lines.forEach((line, index) => {
    page.drawText(line, { font, size: 12, x: 36, y: 790 - index * 30 });
  });
  const pdfBytes = await document.save();
  const config = getOpenRouterConfig(process.env, "extraction");
  const exerciseFallback = process.argv.includes("--fallback");
  let calls = 0;
  const client = new OpenRouterInvoiceExtractionClient({
    ...config,
    fetchImplementation: async (url, init) => {
      calls += 1;
      if (exerciseFallback && calls === 1) {
        // The primary failure is synthetic; only the real fallback is billed.
        return new Response(JSON.stringify({ error: {
          code: "NO_ELIGIBLE_ENDPOINT",
          message: "No eligible endpoints found for the requested model.",
        } }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      return fetch(url, init);
    },
  });
  const result = await client.extractInvoice({
    fileName: "synthetic-extraction-smoke.pdf",
    mimeType: "application/pdf",
    signedUrl: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`,
  });

  assert.equal(Number(result.data.totalAmount), 15, "O total do recibo sintético deve ser preservado.");
  assert.ok(result.data.items.length > 0, "A linha do recibo sintético deve ser extraída.");
  if (exerciseFallback) {
    assert.equal(result.attempts, 2, "A recuperação deve ocorrer uma única vez.");
    assert.equal(result.model, config.pdfFallbackModel, "A recuperação deve usar o modelo distinto configurado.");
  }
  console.info(JSON.stringify({
    outcome: "passed",
    scenario: exerciseFallback ? "synthetic-404-real-fallback" : "real-primary",
    model: result.model,
    provider: result.provider ?? null,
    attempts: result.attempts,
    latencyMs: result.latencyMs,
    documentKind: result.data.documentKind,
    itemCount: result.data.items.length,
    totalMatches: true,
    costUsd: result.usage?.costUsd ?? null,
  }, null, 2));
}

main().catch((error: unknown) => {
  const details = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  // Only fixed labels and bounded numeric diagnostics are emitted on failure.
  console.error(JSON.stringify({
    outcome: "failed",
    kind: typeof details.kind === "string" ? details.kind : "smoke-assertion-or-runtime",
    status: typeof details.status === "number" ? details.status : null,
    diagnostic: typeof details.diagnostic === "string" ? details.diagnostic : null,
    attempts: typeof details.attempts === "number" ? details.attempts : null,
  }, null, 2));
  process.exitCode = 1;
});

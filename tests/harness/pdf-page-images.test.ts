import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { renderPdfPageImages, validatePdfPageImages } from "@/server/integrations/openrouter/pdf-page-images";
import { getOpenRouterConfig, shouldReadVisualPdfWindows } from "@/server/integrations/openrouter/config";

test("renderização local preserva ordem, orientação e dimensões limitadas sem reexportar PDF", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); pdf.addPage([800, 600]);
  const bytes = await pdf.save(), before = Buffer.from(bytes);
  const images = await renderPdfPageImages(bytes, [2, 1], 2);
  const sizes = images.map(image => { const png = Buffer.from(image.split(",")[1], "base64");
    return [png.readUInt32BE(16), png.readUInt32BE(20)]; });
  assert.deepEqual(sizes, [[2400, 1800], [1800, 2400]]);
  assert.deepEqual(Buffer.from(bytes), before);
});

test("limites e entradas inválidas são recusados antes do worker/provedor", async () => {
  for (const pages of [[], [0], [1, 1], [3], [1, 2, 3, 4, 5]])
    await assert.rejects(renderPdfPageImages(new Uint8Array([1]), pages, 2), /Invalid bounded/);
  for (const images of [[], ["https://example.invalid/private.png"], ["data:image/png;base64,iVBORw0KGgo!"]])
    assert.throws(() => validatePdfPageImages(images, 1), /Invalid bounded/);
  await assert.rejects(renderPdfPageImages(new Uint8Array([1]), [1], 1));
});

test("rota visual exige opt-in e usa número físico de páginas, não fornecedor ou valor", () => {
  const environment = { NODE_ENV: "test" as const, OPENROUTER_API_KEY: "synthetic" };
  const off = getOpenRouterConfig(environment, "extraction");
  const on = getOpenRouterConfig({ ...environment, OPENROUTER_PDF_VISUAL_WINDOWS: "true" }, "extraction");
  assert.equal(shouldReadVisualPdfWindows(off, { mimeType: "application/pdf", pageCount: 23 }), false);
  for (const pageCount of [5, 6, 23, 32]) assert.equal(shouldReadVisualPdfWindows(on, { mimeType: "application/pdf", pageCount }), true);
  for (const pageCount of [null, 0, 1, 4, 33]) assert.equal(shouldReadVisualPdfWindows(on, { mimeType: "application/pdf", pageCount }), false);
  assert.equal(shouldReadVisualPdfWindows(on, { mimeType: "image/png", pageCount: 23 }), false);
  assert.throws(() => getOpenRouterConfig({ ...environment, OPENROUTER_PDF_VISUAL_WINDOWS: "yes" }, "extraction"));
});

import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// No document scripts, remote resources, temporary files or application secrets
// are needed. Run outside the request thread and terminate on a bounded deadline.
const { bytes, pages, pageCount } = workerData;
// Keep a filesystem path. Turbopack rewrites require.resolve(package.json) to
// a module ID inside worker entries, which is not a path for PDF.js assets.
const packageRoot = join(process.cwd(), "node_modules", "pdfjs-dist");
const assetDirectory = name => join(packageRoot, name).replaceAll("\\", "/") + "/";
const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
  useWorkerFetch: false, useSystemFonts: false, enableXfa: false,
  cMapUrl: assetDirectory("cmaps"), cMapPacked: true,
  standardFontDataUrl: assetDirectory("standard_fonts"),
  wasmUrl: assetDirectory("wasm"), verbosity: 0 });
try {
  const pdf = await task.promise;
  if (pdf.numPages !== pageCount) throw new Error("PDF_PAGE_COUNT_MISMATCH");
  const images = [];
  for (const number of pages) {
    const page = await pdf.getPage(number);
    const natural = page.getViewport({ scale: 1 });
    if (!Number.isFinite(natural.width + natural.height) || natural.width <= 0 || natural.height <= 0)
      throw new Error("PDF_PAGE_DIMENSIONS_INVALID");
    const viewport = page.getViewport({ scale: 2400 / Math.max(natural.width, natural.height) });
    const surface = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport }).promise;
      const png = surface.canvas.toBuffer("image/png");
      if (png.length > 6 * 1024 * 1024) throw new Error("PDF_PAGE_IMAGE_TOO_LARGE");
      images.push(new Uint8Array(png));
    } finally {
      pdf.canvasFactory.destroy(surface);
      page.cleanup();
    }
  }
  parentPort.postMessage({ images });
} catch {
  // Never echo document content, parser internals or paths in the error channel.
  parentPort.postMessage({ error: "PDF_IMAGE_RENDER_FAILED" });
} finally {
  await task.destroy();
}

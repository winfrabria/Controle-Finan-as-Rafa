import "server-only";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { z } from "zod";

const pngPrefix = "data:image/png;base64,";
export function validatePdfPageImages(images: string[], pageCount?: number | null) {
  if (!pageCount || images.length !== pageCount || images.length > 4 ||
    images.some(value => typeof value !== "string" || !value.startsWith(`${pngPrefix}iVBORw0KGgo`) ||
      value.length > 8_388_630 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(pngPrefix.length))))
    throw new Error("Invalid bounded PDF page images.");
  return images;
}

/** Full-page rendering only. The original bytes and page order are unchanged.
 * A dedicated worker prevents PDF decoding from blocking job heartbeats. */
export async function renderPdfPageImages(bytes: Uint8Array, pages: number[], pageCount: number): Promise<string[]> {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024 || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 32 ||
    pages.length < 1 || pages.length > 4 || new Set(pages).size !== pages.length ||
    pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > pageCount))
    throw new Error("Invalid bounded PDF rendering request.");
  const worker = new Worker(resolve(process.cwd(), "scripts/pdf-image-worker.mjs"), {
    workerData: { bytes, pages, pageCount }, env: {},
    resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await new Promise<unknown>((resolveResult, reject) => {
      timer = setTimeout(() => reject(new Error("PDF rendering deadline exceeded.")), 60_000);
      worker.once("message", resolveResult);
      worker.once("error", () => reject(new Error("PDF rendering worker failed.")));
      worker.once("exit", () => reject(new Error("PDF rendering worker ended without a result.")));
    });
    const result = z.object({ images: z.array(z.instanceof(Uint8Array)).min(1).max(4) }).parse(data);
    return validatePdfPageImages(result.images.map(image => `${pngPrefix}${Buffer.from(image).toString("base64")}`), pages.length);
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}

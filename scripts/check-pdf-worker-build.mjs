import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";

// Exercises the actual production artifact: source-level unit tests cannot
// detect bundler rewrites of worker asset paths. No network or model calls.
const directory = resolve(".next/server/chunks");
const entries = (await readdir(directory)).filter(name => /^\[worker thread\]-scripts_pdf-image-worker_mjs_.*\.js$/.test(name));
assert.equal(entries.length, 1, "Expected one compiled PDF rendering worker.");
const pdf = await PDFDocument.create(); pdf.addPage([800, 600]);
const worker = new Worker(resolve(directory, entries[0]), { env: {},
  resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
  workerData: { bytes: await pdf.save(), pages: [1], pageCount: 1 } });
let timer;
try {
  const result = await new Promise((done, reject) => {
    timer = setTimeout(() => reject(new Error("Compiled worker timeout")), 60_000);
    worker.once("message", done); worker.once("error", reject);
    worker.once("exit", () => reject(new Error("Compiled worker exited without image")));
  });
  assert.equal(result.error, undefined);
  assert.equal(result.images.length, 1);
  const png = Buffer.from(result.images[0]);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [2400, 1800]);
  console.log("Compiled PDF worker: PASS; full page 2400x1800, no model calls.");
} finally {
  clearTimeout(timer); await worker.terminate();
}

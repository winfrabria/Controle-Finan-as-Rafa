import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { computeAttachmentMetadata } from "./attachment-metadata";

test("calcula SHA-256 e número de páginas sem usar provedor", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  pdf.addPage();
  const bytes = await pdf.save();
  const metadata = await computeAttachmentMetadata({
    bytes,
    mimeType: "application/pdf",
  });
  assert.equal(metadata.pageCount, 3);
  assert.match(metadata.sha256, /^[0-9a-f]{64}$/);
});

test("PDF inválido preserva hash e deixa leitura para o pipeline", async () => {
  const metadata = await computeAttachmentMetadata({
    bytes: new TextEncoder().encode("not-a-pdf"),
    mimeType: "application/pdf",
  });
  assert.equal(metadata.pageCount, null);
  assert.match(metadata.sha256, /^[0-9a-f]{64}$/);
});

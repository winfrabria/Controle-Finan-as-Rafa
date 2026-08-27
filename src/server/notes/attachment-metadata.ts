import "server-only";

import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";

export async function computeAttachmentMetadata(input: {
  bytes: Uint8Array;
  mimeType: string;
}) {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (input.mimeType === "image/jpeg" || input.mimeType === "image/png") {
    return { pageCount: 1, sha256 };
  }
  if (input.mimeType !== "application/pdf") {
    return { pageCount: null, sha256 };
  }
  try {
    const document = await PDFDocument.load(input.bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const count = document.getPageCount();
    return { pageCount: count > 0 ? count : null, sha256 };
  } catch {
    // Metadata never becomes an upload gate. Extraction classifies invalid,
    // encrypted or unreadable content with the canonical failure categories.
    return { pageCount: null, sha256 };
  }
}

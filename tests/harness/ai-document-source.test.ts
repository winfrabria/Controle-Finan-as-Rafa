import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiDocumentSource, requiresInlineDocument } from "../../src/server/storage/ai-document-source";
import { sanitizeForPersistence } from "../../src/lib/audit-harness/security";
const path = "obras/00000000-0000-4000-8000-000000000001/notas/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003.pdf";
test("URLs públicas não são baixadas novamente; arquivo local vai como bytes privados", async () => {
  let downloads = 0;
  const download = async (value: string) => { assert.equal(value, path); downloads++; return new Blob(["%PDF-1.7\nsynthetic test"]); };
  const input = { path, signedUrl: "https://storage.example.test/file.pdf?token=test", mimeType: "application/pdf", fileName: "test.pdf" };
  assert.equal(await resolveAiDocumentSource(input, { download }), input.signedUrl);
  assert.equal(downloads, 0);
  const inline = await resolveAiDocumentSource({ ...input, signedUrl: "http://127.0.0.1:55321/file.pdf" }, { download });
  assert.ok(inline.startsWith("data:application/pdf;base64,"));
  assert.equal(downloads, 1);
  assert.equal(sanitizeForPersistence(inline), "[REDACTED_DOCUMENT_BYTES]");
  assert.ok((await resolveAiDocumentSource({ ...input, forceInline: true }, { download })).startsWith("data:application/pdf;base64,"));
  assert.equal(downloads, 2);
});
test("arquivos privados respeitam caminho, assinatura e limite de upload", async () => {
  assert.equal(requiresInlineDocument("https://192.168.1.1/file.pdf"), true);
  await assert.rejects(resolveAiDocumentSource({ path: "../../private", signedUrl: "http://localhost/file.pdf", mimeType: "application/pdf", fileName: "test.pdf" }, {
    download: async () => { throw new Error("Must not download"); },
  }));
  await assert.rejects(resolveAiDocumentSource({ path, signedUrl: "http://localhost/file.pdf", mimeType: "application/pdf", fileName: "test.pdf" }, {
    download: async () => new Blob(["not a PDF"]),
  }));
});

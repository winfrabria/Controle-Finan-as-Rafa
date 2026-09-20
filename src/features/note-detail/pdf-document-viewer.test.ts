import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("PDF usa renderização própria com páginas, cancelamento e acesso renovável", () => {
  const preview = readFileSync("src/features/note-detail/note-document-preview.tsx", "utf8");
  const viewer = readFileSync("src/features/note-detail/pdf-document-viewer.tsx", "utf8");
  assert.match(preview, /previewKind === "pdf"/);
  assert.match(preview, /<PdfDocumentViewer/);
  for (const required of ["getDocument", "getPage(page)", "render?.cancel()", "task?.destroy()", "window.location.reload()", "Próxima página", "Página anterior", "Ir para página do PDF", "disableRange: true"]) assert.ok(viewer.includes(required), required);
  assert.ok(!viewer.includes("<iframe"));
  assert.ok(!preview.includes("<iframe"));
  assert.ok(viewer.includes("if (!canLoad) return;"));
  assert.ok(viewer.includes("if (entry.contentRect.width <= 0) return;"));
});

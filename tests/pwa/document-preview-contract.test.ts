import assert from "node:assert/strict";
import test from "node:test";

import { resolveNoteDocumentPreviewKind } from "../../src/features/note-detail/note-document-policy";

test("documento real sem URL nunca recebe DANFE de demonstração", () => {
  assert.equal(
    resolveNoteDocumentPreviewKind({
      documentUrl: null,
      isDemo: false,
      isImage: false,
    }),
    "unavailable",
  );
});

test("DANFE sintético aparece somente para dado explicitamente demo", () => {
  assert.equal(
    resolveNoteDocumentPreviewKind({
      documentUrl: null,
      isDemo: true,
      isImage: false,
    }),
    "demo",
  );
});

test("documentos reais com URL preservam o visualizador correto", () => {
  assert.equal(
    resolveNoteDocumentPreviewKind({
      documentUrl: "https://storage.test/nota.pdf",
      isDemo: false,
      isImage: false,
    }),
    "pdf",
  );
  assert.equal(
    resolveNoteDocumentPreviewKind({
      documentUrl: "https://storage.test/nota.png",
      isDemo: false,
      isImage: true,
    }),
    "image",
  );
});

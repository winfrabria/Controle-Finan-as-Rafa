import assert from "node:assert/strict";
import test from "node:test";

import { attachmentReference } from "./attachment-reference";

test("preserva o número fiscal quando ele foi identificado", () => {
  assert.equal(attachmentReference("000.001.282", "abc"), "000.001.282");
});

test("cria um protocolo estável quando o anexo não tem número fiscal", () => {
  assert.equal(
    attachmentReference(null, "b5fe1215-040f-42cd-8b6d-ceafab49a4a1"),
    "ANX-B5FE12",
  );
});

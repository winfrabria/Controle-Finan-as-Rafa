import assert from "node:assert/strict";
import test from "node:test";

import { resolvePublicUploadResult } from "./public-upload-status";

const base = { etapa: "COMPLETED", id: "note-1" };

test("mapeia todos os resultados terminais do upload público", () => {
  assert.equal(
    resolvePublicUploadResult({ ...base, classificacao: "OK", status: "OK" }),
    "OK",
  );
  assert.equal(
    resolvePublicUploadResult({
      ...base,
      classificacao: "NO_PARAMETER",
      status: "OK",
    }),
    "NO_PARAMETER",
  );
  assert.equal(
    resolvePublicUploadResult({
      ...base,
      classificacao: "SUSPICIOUS",
      status: "PENDING_VALIDATION",
    }),
    "SUSPICIOUS",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, status: "READ_FAILED" }),
    "READ_FAILED",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, status: "FAILED" }),
    "FAILED",
  );
  assert.equal(
    resolvePublicUploadResult({ ...base, etapa: "ANALYZING", status: "PROCESSING" }),
    null,
  );
});

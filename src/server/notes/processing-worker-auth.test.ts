import assert from "node:assert/strict";
import test from "node:test";

import { authorizeProcessingWorker } from "./processing-worker-auth";

test("worker recusa execução quando o segredo não está configurado", () => {
  assert.deepEqual(authorizeProcessingWorker("Bearer qualquer", undefined), {
    code: "WORKER_NOT_CONFIGURED",
    ok: false,
  });
});

test("worker exige Bearer e comparação exata do segredo", () => {
  const secret = "segredo-de-worker-com-32-caracteres";

  assert.deepEqual(authorizeProcessingWorker(null, secret), {
    code: "WORKER_UNAUTHORIZED",
    ok: false,
  });
  assert.deepEqual(authorizeProcessingWorker("Bearer incorreto", secret), {
    code: "WORKER_UNAUTHORIZED",
    ok: false,
  });
  assert.deepEqual(authorizeProcessingWorker(`Bearer ${secret}`, secret), {
    ok: true,
  });
});

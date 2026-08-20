import assert from "node:assert/strict";
import test from "node:test";

import { classifyPushSendFailure } from "./web-push-client";

function failure(statusCode?: number) {
  return Object.assign(new Error("provider body must not be persisted"), {
    statusCode,
  });
}

test("remove inscrições expiradas e repete somente falhas temporárias", () => {
  assert.deepEqual(classifyPushSendFailure(failure(410)), {
    code: "PUSH_SUBSCRIPTION_EXPIRED",
    expired: true,
    message: "A inscrição deste aparelho expirou.",
    retryable: false,
    statusCode: 410,
  });
  assert.equal(classifyPushSendFailure(failure(429)).retryable, true);
  assert.equal(classifyPushSendFailure(failure(503)).retryable, true);
  assert.equal(classifyPushSendFailure(failure(403)).retryable, false);
  assert.equal(classifyPushSendFailure(failure()).retryable, true);
});

test("mensagem segura nunca persiste o corpo retornado pelo provedor", () => {
  const result = classifyPushSendFailure(failure(400));
  assert.doesNotMatch(result.message, /provider body/i);
});

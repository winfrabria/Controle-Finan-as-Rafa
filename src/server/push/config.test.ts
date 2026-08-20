import assert from "node:assert/strict";
import test from "node:test";

import { getWebPushConfig, getWebPushPublicStatus } from "./config";

const validEnvironment = {
  NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: "A".repeat(87),
  WEB_PUSH_VAPID_PRIVATE_KEY: "B".repeat(43),
  WEB_PUSH_VAPID_SUBJECT: "mailto:suporte@winfrabr.com.br",
};

test("configuração VAPID só fica ativa com as três variáveis válidas", () => {
  assert.equal(getWebPushConfig({}), null);
  assert.equal(
    getWebPushConfig({ ...validEnvironment, WEB_PUSH_VAPID_SUBJECT: "invalido" }),
    null,
  );
  assert.deepEqual(getWebPushConfig(validEnvironment), {
    privateKey: validEnvironment.WEB_PUSH_VAPID_PRIVATE_KEY,
    publicKey: validEnvironment.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
    subject: validEnvironment.WEB_PUSH_VAPID_SUBJECT,
  });
  assert.deepEqual(getWebPushPublicStatus(validEnvironment), {
    configured: true,
    publicKey: validEnvironment.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
  });
});

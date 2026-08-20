import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSuspiciousNotePushPayload,
  isAllowedPushPath,
  safePushPath,
} from "../../src/lib/push/push-contract";

test("payload suspeito é genérico e aponta para o anexo sem dados financeiros", () => {
  const payload = buildSuspiciousNotePushPayload({
    noteId: "note-123",
    notificationId: "notification-123",
    unreadCount: 2,
  });

  assert.equal(payload.path, "/revisao/notas?anexo=note-123");
  assert.equal(payload.unreadCount, 2);
  assert.doesNotMatch(
    `${payload.title} ${payload.body}`,
    /fornecedor|valor|cnpj|arquivo|diagnóstico detalhado/i,
  );
});

test("navegação do push aceita somente destinos internos conhecidos", () => {
  for (const path of [
    "/revisao/notas?anexo=1",
    "/admin/historico",
    "/notas/abc/analise-ia",
  ]) {
    assert.equal(isAllowedPushPath(path), true, path);
    assert.equal(safePushPath(path), path);
  }
  for (const path of ["https://evil.test", "//evil.test", "/api/notas", "/login"]) {
    assert.equal(isAllowedPushPath(path), false, path);
    assert.equal(safePushPath(path), "/revisao/notas");
  }
});

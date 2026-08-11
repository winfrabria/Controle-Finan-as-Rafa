import assert from "node:assert/strict";
import test from "node:test";

import { notificationPath } from "./notification-path";

test("notificação pendente abre o anexo na caixa de Notas", () => {
  assert.equal(
    notificationPath({
      basePath: "/revisao",
      isRead: false,
      noteId: "31c93b7c-e290-4f0c-9b1a-16341cbb8e80",
    }),
    "/revisao/notas?anexo=31c93b7c-e290-4f0c-9b1a-16341cbb8e80",
  );
});

test("notificação de anexo já lido abre o item no Histórico", () => {
  assert.equal(
    notificationPath({
      basePath: "/admin",
      documentNumber: "NF 5249/2026",
      isRead: true,
    }),
    "/admin/historico?busca=NF%205249%2F2026",
  );
});

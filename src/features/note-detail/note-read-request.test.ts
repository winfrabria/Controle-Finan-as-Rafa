import assert from "node:assert/strict";
import test from "node:test";
import { requestNoteRead } from "./note-read-request";

test("marcação envia a versão vista e tem prazo de confirmação", async () => {
  await requestNoteRead("synthetic", 7, async (url, init) => {
    assert.equal(url, "/api/notas/synthetic/read");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { version: 7 });
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response("{}", { status: 200 });
  });
});

test("conflito de versão e falha de rede não são tratados como leitura salva", async () => {
  await assert.rejects(requestNoteRead("synthetic", 7, async () => new Response(JSON.stringify({
    erro: { mensagem: "A análise mudou. Atualize a página." },
  }), { status: 409 })), /A análise mudou/);
  await assert.rejects(requestNoteRead("synthetic", 7, async () => { throw new DOMException("Timeout", "TimeoutError"); }), { name: "TimeoutError" });
});

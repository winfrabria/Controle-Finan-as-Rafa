import assert from "node:assert/strict";
import test from "node:test";
import { canShowStoredCompletion, readSubmissionHistory, rememberSubmission, submissionStageLabel, type SubmissionHistoryEntry } from "./submission-history";

function store() {
  const records = new Map<string, string>();
  return { records, getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } };
}

test("somente conclusão já recebida pode ser reaberta sem consultar o acesso temporário", () => {
  const entry: SubmissionHistoryEntry = { noteId: "note-a", protocolo: "A", stage: "COMPLETED" };
  assert.equal(canShowStoredCompletion(entry), true);
  for (const stage of ["READING", "CHECKING", "NEEDS_CONTEXT", "READ_FAILED", "FAILED"] as const) {
    assert.equal(canShowStoredCompletion({ ...entry, stage }), false);
  }
});

test("dois recebimentos durante a leitura mantêm protocolos e progresso independentes", () => {
  const session = store();
  rememberSubmission(session, { noteId: "note-a", protocolo: "A", stage: "READING" });
  rememberSubmission(session, { noteId: "note-b", protocolo: "B", stage: "READING" });
  assert.deepEqual(readSubmissionHistory(session), [
    { noteId: "note-b", protocolo: "B", stage: "READING" },
    { noteId: "note-a", protocolo: "A", stage: "READING" },
  ]);
  rememberSubmission(session, { noteId: "note-a", protocolo: "A", stage: "CHECKING" });
  assert.equal(readSubmissionHistory(session).find(item => item.noteId === "note-b")?.stage, "READING");
  assert.match(submissionStageLabel("READING"), /leitura em segundo plano/);
});
test("enviar outra nota preserva referência anterior sem misturar andamento", () => {
  const session = store();
  rememberSubmission(session, { noteId: "note-a", protocolo: "A", stage: "CHECKING" });
  rememberSubmission(session, { noteId: "note-b", protocolo: "B", stage: "READING" });
  assert.deepEqual(readSubmissionHistory(session).map(item => [item.noteId, item.stage]), [["note-b", "READING"], ["note-a", "CHECKING"]]);
  rememberSubmission(session, { noteId: "note-a", protocolo: "A", stage: "COMPLETED" });
  assert.equal(readSubmissionHistory(session).length, 2);
  assert.equal(readSubmissionHistory(session).find(item => item.noteId === "note-b")?.stage, "READING");
});
test("histórico é limitado e não armazena credenciais ou campos extras", () => {
  const session = store();
  for (let index = 0; index < 25; index++) rememberSubmission(session, { noteId: `note-${index}`, protocolo: `${index}`, stage: "READING" });
  assert.equal(readSubmissionHistory(session).length, 20);
  session.setItem("winfrabr.public-submissions.v1", JSON.stringify([{ noteId: "note-a", protocolo: "A", stage: "CHECKING", token: "secret" }]));
  assert.equal(Object.hasOwn(readSubmissionHistory(session)[0], "token"), false);
});
test("armazenamento indisponível não converte envio recebido em erro", () => {
  const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.deepEqual(readSubmissionHistory(denied), []);
  assert.equal(rememberSubmission(denied, { noteId: "note-a", protocolo: "A", stage: "CHECKING" }).length, 1);
  assert.match(submissionStageLabel("CHECKING"), /segundo plano/);
});

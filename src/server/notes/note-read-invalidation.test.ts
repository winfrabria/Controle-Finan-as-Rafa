import assert from "node:assert/strict";
import test from "node:test";

import { invalidateNoteReads } from "./note-read-invalidation";

test("invalida leituras usando o delegate da transação da auditoria", async () => {
  const calls: unknown[] = [];
  const transaction = {
    noteRead: {
      deleteMany: async (input: unknown) => {
        calls.push(input);
        return { count: 2 };
      },
    },
  };

  await invalidateNoteReads(transaction, "note-1");
  assert.deepEqual(calls, [{ where: { noteId: "note-1" } }]);
});

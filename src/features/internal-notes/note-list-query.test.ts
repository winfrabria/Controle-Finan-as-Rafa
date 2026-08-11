import assert from "node:assert/strict";
import test from "node:test";

import { buildNoteReadFilter } from "./note-read-filter";

test("separa a caixa de entrada do histórico por usuário", () => {
  assert.deepEqual(buildNoteReadFilter("reviewer-1", "unread"), {
    noteReads: { none: { profileId: "reviewer-1" } },
  });
  assert.deepEqual(buildNoteReadFilter("reviewer-1", "read"), {
    noteReads: { some: { profileId: "reviewer-1" } },
  });
  assert.deepEqual(buildNoteReadFilter(undefined, "read"), {
    noteReads: { some: {} },
  });
});

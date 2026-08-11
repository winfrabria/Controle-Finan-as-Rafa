import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResponsibleName } from "./responsible-name";

test("corrige o nome legado do responsável Naldo", () => {
  assert.equal(normalizeResponsibleName("Nlado"), "Naldo");
  assert.equal(normalizeResponsibleName(" Naldo "), "Naldo");
  assert.equal(normalizeResponsibleName(null), null);
});

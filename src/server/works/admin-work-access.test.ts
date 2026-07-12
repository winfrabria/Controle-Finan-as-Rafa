import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_ONLY_ROLES, canAccess } from "@/server/auth/access-policy";

test("somente ADMIN pode acessar a administração de obras", () => {
  assert.equal(canAccess("ADMIN", ADMIN_ONLY_ROLES), true);
  assert.equal(canAccess("REVIEWER", ADMIN_ONLY_ROLES), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_ONLY_ROLES,
  canAccess,
  getRoleHome,
  INTERNAL_ROLES,
  REVIEW_ROLES,
} from "../../src/server/auth/access-policy.ts";

test("ADMIN pode acessar áreas administrativas e de revisão", () => {
  assert.equal(canAccess("ADMIN", ADMIN_ONLY_ROLES), true);
  assert.equal(canAccess("ADMIN", REVIEW_ROLES), true);
  assert.equal(canAccess("ADMIN", INTERNAL_ROLES), true);
});

test("REVIEWER não pode acessar áreas administrativas", () => {
  assert.equal(canAccess("REVIEWER", ADMIN_ONLY_ROLES), false);
  assert.equal(canAccess("REVIEWER", REVIEW_ROLES), true);
  assert.equal(canAccess("REVIEWER", INTERNAL_ROLES), true);
});

test("cada papel possui uma rota inicial própria", () => {
  assert.equal(getRoleHome("ADMIN"), "/admin");
  assert.equal(getRoleHome("REVIEWER"), "/revisao");
});

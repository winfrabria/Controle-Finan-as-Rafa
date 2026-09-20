import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedHarnessTargets } from "../../src/server/testing/isolated-harness";
const local = { HARNESS_ISOLATED_LOCAL: "true", DATABASE_URL: "postgresql://postgres:test@127.0.0.1:55322/postgres",
  DIRECT_URL: "postgresql://postgres:test@127.0.0.1:55322/postgres", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" };
test("fixtures recusam banco remoto, outro stack local, API remota ou flag ausente", () => {
  assert.doesNotThrow(() => assertIsolatedHarnessTargets(local));
  for (const override of [
    { DATABASE_URL: "postgresql://postgres:test@example.test:55322/postgres" },
    { DIRECT_URL: "postgresql://postgres:test@127.0.0.1:54322/postgres" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://example.test" },
    { HARNESS_ISOLATED_LOCAL: undefined },
  ]) assert.throws(() => assertIsolatedHarnessTargets({ ...local, ...override }));
});

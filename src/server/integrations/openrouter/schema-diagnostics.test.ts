import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { safeVerificationSchemaDiagnostics, verificationSchemaDiagnostics } from "./schema-diagnostics";

test("diagnóstico de contrato preserva localização sem texto ou chaves arbitrárias", () => {
  const result = z.object({ checks: z.array(z.object({ state: z.enum(["PASS"]) }).strict()) }).safeParse({
    checks: [{ state: "PRIVATE_VALUE", PRIVATE_KEY: "PRIVATE_VALUE" }] });
  assert.equal(result.success, false); if (result.success) return;
  const diagnostic = verificationSchemaDiagnostics(result.error.issues);
  assert.equal(diagnostic.issueCount, 2);
  assert.deepEqual(diagnostic.issues[0].path, ["checks", 0, "state"]);
  assert.equal(JSON.stringify(diagnostic).includes("PRIVATE"), false);
  assert.deepEqual(safeVerificationSchemaDiagnostics(diagnostic), diagnostic);
  assert.equal(safeVerificationSchemaDiagnostics({ ...diagnostic, content: "PRIVATE" }), null);
  assert.equal(safeVerificationSchemaDiagnostics({ issueCount: 1, issues: [{ code: "custom", path: ["PRIVATE_KEY"] }] }), null);
});

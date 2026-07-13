import assert from "node:assert/strict";
import test from "node:test";

import { createDemoNoteDetail } from "./note-detail-demo";

test("dados técnicos da auditoria comparativa existem apenas para ADMIN", () => {
  const admin = createDemoNoteDetail({ id: "demo-audit-test", role: "ADMIN" });
  const reviewer = createDemoNoteDetail({
    id: "demo-audit-test",
    role: "REVIEWER",
  });

  assert.equal(admin.viewerRole, "ADMIN");
  assert.ok(admin.technical.aiRuns.length > 0);
  assert.equal(admin.analysis.findings[0]?.confidence, 0.98);

  assert.equal(reviewer.viewerRole, "REVIEWER");
  assert.equal("technical" in reviewer, false);
  assert.equal("confidence" in reviewer.analysis.findings[0]!, false);
  assert.equal("justification" in reviewer.analysis.findings[0]!, false);
});

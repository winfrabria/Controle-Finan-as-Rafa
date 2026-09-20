import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";

/** One explicit real upload through the production route. No retry or injected
 * model results. A durable run tag prevents an uncertain request being resent. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, source, tag, ...rest] = process.argv.slice(2);
  assert(mode === "--online" && source && /^[a-z0-9-]{1,60}$/.test(tag ?? "") && rest.length === 0);
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  assert(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname) && base.port === "3117");
  const bytes = await readFile(resolve(source));
  assert(bytes.length <= 10 * 1024 * 1024 && bytes.subarray(0, 5).toString() === "%PDF-");
  const work = await prisma.work.findUniqueOrThrow({ where: { code: "LOCAL-104" }, select: { id: true, active: true } });
  assert(work.active);
  const reportPath = resolve("tmp", `single-upload-${tag}.json`);
  const report: Record<string, unknown> = { scope: "ONE_REAL_ISOLATED_HTTP_UPLOAD", startedAt: new Date().toISOString(),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"), state: "STARTED" };
  await writeFile(reportPath, JSON.stringify(report), { flag: "wx" });
  const save = () => writeFile(reportPath, JSON.stringify(report, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
  console.log(JSON.stringify({ report: reportPath, state: "STARTED" }));
  const started = Date.now();
  try {
    const form = new FormData(); form.set("obraId", work.id);
    form.set("arquivo", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), basename(source));
    const response = await fetch(new URL("/api/notas", base), { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 201, `Upload HTTP ${response.status}; do not resend automatically.`);
    const payload = await response.json();
    const noteId = payload.nota.id as string;
    assert.match(noteId, /^[a-f0-9-]{36}$/);
    Object.assign(report, { noteId, protocol: payload.nota.protocolo, acceptedMs: Date.now() - started, state: "ACCEPTED" });
    await save(); console.log(JSON.stringify({ noteId, protocol: report.protocol, acceptedMs: report.acceptedMs }));
    const denied = await fetch(new URL(`/api/notas/${noteId}/status`, base), { signal: AbortSignal.timeout(10_000) });
    report.anonymousStatusDenied = [401, 403, 404].includes(denied.status);
    let previous = "";
    while (Date.now() - started < 20 * 60_000) {
      const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId }, select: {
        processingStage: true, status: true, failureCode: true, classification: true, assuranceBand: true,
        extractedData: true, aiRuns: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true,
          model: true, latencyMs: true, costUsd: true, errorCode: true, structuredResponse: true } },
        findings: { where: { status: "OPEN" }, select: { code: true, source: true, actualValue: true, expectedValue: true, evidence: true } },
      } });
      report.pipeline = note;
      const checkpoints = await prisma.noteEvent.count({ where: { noteId, type: "EXTRACTION_WINDOW_CHECKPOINT" } });
      const state = JSON.stringify({ stage: note.processingStage, status: note.status, checkpoints, runs: note.aiRuns.map(run => [run.kind, run.status]) });
      if (state !== previous) { previous = state; await save(); console.log(JSON.stringify({ noteId, elapsedMs: Date.now() - started, ...JSON.parse(state) })); }
      if (["COMPLETED", "FAILED"].includes(note.processingStage) || note.status === "FAILED") {
        report.state = "TERMINAL"; report.totalMs = Date.now() - started; await save();
        console.log(JSON.stringify({ noteId, state: "TERMINAL", stage: note.processingStage, totalMs: report.totalMs,
          findings: note.findings.map(finding => finding.code), runs: note.aiRuns.map(({ kind, status, model, costUsd, latencyMs, errorCode }) => ({ kind, status, model, costUsd, latencyMs, errorCode })) }));
        if (note.processingStage !== "COMPLETED") process.exitCode = 1;
        return;
      }
      await new Promise(done => setTimeout(done, 5000));
    }
    report.state = "OBSERVATION_TIMEOUT_NOT_CANCELLATION"; await save(); process.exitCode = 1;
  } catch (error) {
    report.observationError = error instanceof Error ? error.name : "UnknownError";
    await save(); throw error;
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Upload observation failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

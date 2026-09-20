import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { resolvePublicProcessingPhase } from "../src/features/public-upload/public-upload-status";

/** Two explicit, paid, real uploads to the loopback app. No provider mocks,
 * no reupload/retry after observation expiry, no credentials in the report. */
async function main() {
  assertIsolatedHarnessTargets();
  const [mode, ...paths] = process.argv.slice(2);
  assert(mode === "--online" && paths.length === 2, "Pass --online and exactly two explicit PDFs.");
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  assert(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname) && base.port === "3117");
  const files = await Promise.all(paths.map(async path => {
    assert(path.toLowerCase().endsWith(".pdf"));
    const bytes = await readFile(resolve(path));
    assert(bytes.length > 0 && bytes.length <= 10 * 1024 * 1024);
    assert(bytes.subarray(0, 5).toString() === "%PDF-");
    return { name: basename(path), bytes };
  }));
  const work = await prisma.work.findUniqueOrThrow({ where: { code: "LOCAL-104" }, select: { id: true, active: true } });
  assert(work.active);
  const reportPath = resolve("tmp", `overlapping-uploads-${randomUUID()}.json`);
  const report: { scope: string; startedAt: string; results: Array<Record<string, unknown>>; overlapObserved?: boolean } = {
    scope: "ISOLATED_REAL_HTTP_UPLOADS_AFTER_READING", startedAt: new Date().toISOString(), results: [],
  };
  let saving = Promise.resolve();
  const save = () => { const json = JSON.stringify(report, null, 2); saving = saving.then(() => writeFile(reportPath, json)); return saving; };
  await save();
  console.log(JSON.stringify({ report: reportPath }));
  async function upload(index: number) {
    const file = files[index]; const startedAt = Date.now();
    const form = new FormData(); form.set("obraId", work.id);
    form.set("arquivo", new Blob([new Uint8Array(file.bytes)], { type: "application/pdf" }), file.name);
    const response = await fetch(new URL("/api/notas", base), { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 201, `Upload ${index + 1} failed; do not automatically resend.`);
    const payload = await response.json(); const id = payload.nota.id as string;
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert(id && cookie);
    const timeline: Array<{ publicState: string; stage: string; elapsedMs: number }> = [];
    const record: Record<string, unknown> = { noteId: id, fileName: file.name, acceptedAt: Date.now(), uploadMs: Date.now() - startedAt, timeline };
    report.results.push(record); await save();
    console.log(JSON.stringify({ stage: "ACCEPTED", noteId: id, uploadMs: record.uploadMs }));
    let onReady!: (readable: boolean) => void;
    const readable = new Promise<boolean>(resolveReady => { onReady = resolveReady; });
    const completion = (async () => {
      let previous = "";
      try {
        const denied = await fetch(new URL(`/api/notas/${id}/status`, base), { signal: AbortSignal.timeout(10_000) });
        assert([401, 403, 404].includes(denied.status), "Status must not be public without its capability.");
        record.anonymousStatusDenied = true;
        while (Date.now() - startedAt < 360_000) {
          const response = await fetch(new URL(`/api/notas/${id}/status`, base), { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
          assert.equal(response.status, 200);
          const state = (await response.json()).nota;
          const key = `${state.estadoPublico}:${state.etapa}`;
          if (key !== previous) {
            timeline.push({ publicState: state.estadoPublico, stage: state.etapa, elapsedMs: Date.now() - startedAt }); previous = key;
            console.log(JSON.stringify({ noteId: id, ...timeline.at(-1) })); await save();
          }
          if (resolvePublicProcessingPhase(state.etapa) === "CHECKING" && !record.readableAt) {
            record.readableAt = Date.now(); onReady(true);
          }
          if (["COMPLETED", "NEEDS_CONTEXT", "READ_FAILED", "FAILED"].includes(state.estadoPublico)) {
            record.terminal = state.estadoPublico; record.terminalAt = Date.now();
            onReady(state.estadoPublico === "COMPLETED"); break;
          }
          await new Promise(resolveWait => setTimeout(resolveWait, 1000));
        }
        record.terminal ??= "OBSERVATION_TIMEOUT";
        record.pipeline = await prisma.note.findUniqueOrThrow({ where: { id }, select: {
          processingStage: true, classification: true, auditResult: true, assuranceBand: true, failureCode: true,
          aiRuns: { select: { kind: true, status: true, model: true, latencyMs: true, costUsd: true, errorCode: true }, orderBy: { createdAt: "asc" } },
          findings: { where: { status: "OPEN" }, select: { code: true, title: true } },
        } });
        if (record.terminal !== "COMPLETED") process.exitCode = 1;
      } catch (error) {
        record.observationError = error instanceof Error ? error.message : "Observation failed"; process.exitCode = 1;
      } finally { onReady(false); await save(); }
    })();
    return { id, record, readable, completion };
  }
  const first = await upload(0);
  if (!await first.readable) { await first.completion; throw new Error("First note did not reach a readable state; no second upload was purchased."); }
  const second = await upload(1);
  assert.notEqual(first.id, second.id);
  report.overlapObserved = !first.record.terminalAt;
  await save(); await Promise.all([first.completion, second.completion]);
  if (!report.overlapObserved) process.exitCode = 1;
  console.log(JSON.stringify({ report: reportPath, overlapObserved: report.overlapObserved,
    terminal: report.results.map(record => ({ noteId: record.noteId, state: record.terminal })) }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Upload test failed"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

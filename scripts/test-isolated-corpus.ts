import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";

/** Explicit opt-in real uploads. Credentials/capabilities never enter the report. */
async function main() {
  assertIsolatedHarnessTargets();
  const args = process.argv.slice(2);
  assert(args.includes("--online"), "Use --online only after authorizing real provider calls.");
  const files = args.filter((arg) => arg !== "--online");
  assert(files.length > 0 && files.length <= 4, "Pass 1 to 4 explicit PDF paths.");
  assert(files.every((file) => file.toLowerCase().endsWith(".pdf")), "This corpus runner accepts PDFs only.");
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  assert(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname) && base.port === "3117",
    "The application must use the isolated loopback port 3117.");
  const work = await prisma.work.findUniqueOrThrow({ where: { code: "LOCAL-104" }, select: { id: true, active: true } });
  assert(work.active, "The isolated work must be active.");
  const output = resolve("tmp", `corpus-${randomUUID()}.json`);
  await mkdir(resolve("tmp"), { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  const save = () => writeFile(output, JSON.stringify({ isolated: true, results }, null, 2));
  for (const source of files) {
    const bytes = await readFile(resolve(source));
    const form = new FormData();
    form.set("obraId", work.id);
    form.set("arquivo", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), basename(source));
    const startedAt = Date.now();
    const response = await fetch(new URL("/api/notas", base), { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const payload = await response.json();
    assert.equal(response.status, 201, `Upload rejected: ${payload.erro?.codigo ?? response.status}`);
    const noteId = payload.nota.id as string;
    const cookie = response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
    assert(cookie, "The public status capability must be issued.");
    const timeline: Array<{ state: string; ms: number }> = [];
    const result: Record<string, unknown> = { fileName: basename(source), noteId, uploadMs: Date.now() - startedAt, timeline };
    results.push(result);
    await save();
    console.log(JSON.stringify({ uploaded: result.fileName, noteId, uploadMs: result.uploadMs }));
    let previous = "";
    while (Date.now() - startedAt < 360_000) {
      const statusResponse = await fetch(new URL(`/api/notas/${noteId}/status`, base), {
        headers: { cookie }, signal: AbortSignal.timeout(15_000),
      });
      assert.equal(statusResponse.status, 200, "Public status must be available with its capability.");
      const state = (await statusResponse.json()).nota;
      const key = `${state.estadoPublico}:${state.etapa}`;
      if (key !== previous) {
        timeline.push({ state: key, ms: Date.now() - startedAt }); previous = key;
        console.log(JSON.stringify({ fileName: result.fileName, ...timeline.at(-1) }));
        await save();
      }
      if (["COMPLETED", "NEEDS_CONTEXT", "FAILED", "READ_FAILED"].includes(state.estadoPublico)) {
        result.terminal = state.estadoPublico; break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
    result.totalMs = Date.now() - startedAt;
    result.terminal ??= "OBSERVATION_TIMEOUT";
    result.pipeline = await prisma.note.findFirstOrThrow({ where: { id: noteId, workId: work.id }, select: {
      auditResult: true, assuranceBand: true, assuranceReason: true, failureCode: true,
      aiRuns: { orderBy: { createdAt: "asc" }, select: {
        kind: true, model: true, status: true, attempts: true, latencyMs: true, costUsd: true,
        errorCode: true, structuredResponse: true,
      } },
      findings: { select: { code: true, title: true, severity: true, source: true, status: true } },
    } });
    await save();
    console.log(JSON.stringify({ fileName: result.fileName, terminal: result.terminal, totalMs: result.totalMs }));
    if (["FAILED", "READ_FAILED", "OBSERVATION_TIMEOUT"].includes(String(result.terminal))) process.exitCode = 1;
  }
  console.log(JSON.stringify({ report: output, files: results.length }));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Corpus test failed."); process.exitCode = 1;
}).finally(() => prisma.$disconnect());

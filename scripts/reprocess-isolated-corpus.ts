import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { scheduleNoteReprocess, processProcessingJob } from "../src/server/notes/processing-jobs";
import { processNoteExtraction } from "../src/server/notes/process-note-extraction";
import { getOpenRouterInvoiceExtractionClient } from "../src/server/integrations/openrouter/client";
import { WindowedExtractionClient } from "../src/server/integrations/openrouter/windowed-extraction";
import { getOpenRouterConfig } from "../src/server/integrations/openrouter/config";

async function main() {
  assertIsolatedHarnessTargets();
  const args = process.argv.slice(2);
  assert(args.includes("--online"), "Reprocessing requires explicit --online authorization.");
  const windowed = args.includes("--windowed");
  const resumeIndex = args.indexOf("--resume-window-run");
  const resumeRunIds = resumeIndex >= 0 ? args[resumeIndex + 1]?.split(",").filter(Boolean) : undefined;
  if (resumeIndex >= 0) {
    assert(windowed, "Saved windows require --windowed.");
    assert(resumeRunIds?.length && resumeRunIds.length <= 8 &&
      resumeRunIds.every(runId => /^[a-f0-9-]{36}$/.test(runId)), "Supply one or more comma-separated saved window run IDs.");
  }
  const ids = args.filter((arg, index) => arg !== "--online" && arg !== "--windowed" &&
    arg !== "--resume-window-run" && index !== resumeIndex + 1);
  assert(ids.length > 0 && ids.length <= 4 && new Set(ids).size === ids.length, "Supply 1 to 4 distinct local note IDs.");
  const notes = await prisma.note.findMany({ where: { id: { in: ids }, work: { code: "LOCAL-104" } },
    include: { aiRuns: true, findings: true, items: true } });
  assert.equal(notes.length, ids.length, "Every note must belong to the isolated work LOCAL-104.");
  const run = randomUUID();
  const path = resolve("tmp", `reprocess-${run}.json`);
  await mkdir(resolve("tmp"), { recursive: true });
  const after: unknown[] = [];
  // The original extraction snapshot survives reprocessing; this report is private and ignored by Git.
  const save = () => writeFile(path, JSON.stringify({ isolated: true, extractionRoute: windowed ? "EXPERIMENTAL_WINDOWED" : "STANDARD", before: notes, after },
    (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
  await save();
  for (const noteId of ids) {
    const startedAt = Date.now();
    const workerId = `snapshot-reaudit:${run}`;
    const job = await scheduleNoteReprocess(noteId, { isolatedManualWorkerId: workerId });
    console.log(JSON.stringify({ noteId, jobId: job.id, stage: "REPROCESS_STARTED" }));
    try {
      await processProcessingJob(job.id, { workerId,
        processExtraction: (id, dependencies) => processNoteExtraction(id, { ...dependencies,
          client: { extractInvoice: async (request) => {
            const savedWindows = resumeRunIds ? (await Promise.all((await readdir(resolve("tmp")))
              .filter(file => resumeRunIds.some(runId => file.startsWith(`window-read-${runId}-${id}-`)) && file.endsWith(".json"))
              .map(async file => JSON.parse(await readFile(resolve("tmp", file), "utf8")))))
              .filter(event => event.stage === "WINDOW" && event.status === "COMPLETED") : undefined;
            if (resumeRunIds) assert(savedWindows?.length, `No completed windows found for ${id}.`);
            const client = windowed ? new WindowedExtractionClient({ config: getOpenRouterConfig(process.env, "extraction"),
              originalSha256: notes.find(note => note.id === id)!.originalFileSha256!,
              savedWindows,
              checkpoint: async event => { await writeFile(resolve("tmp", `window-read-${run}-${id}-${randomUUID()}.json`),
                JSON.stringify(event, null, 2), { flag: "wx" }); },
            }) : getOpenRouterInvoiceExtractionClient();
            const result = await client.extractInvoice(request);
            await writeFile(resolve("tmp", `extraction-${run}-${id}.json`), JSON.stringify({
              fileSha256: notes.find((note) => note.id === id)?.originalFileSha256, result }, null, 2));
            return result;
          } },
        }),
      });
    } catch (error) {
      const cause = error instanceof Error ? error.cause : null;
      const diagnostic = cause instanceof Error ? cause.message
        .replace(/https?:\/\/[^\s]+/g, "[URL REDACTED]").replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[DB URL REDACTED]")
        .slice(-2000) : null;
      console.log(JSON.stringify({ noteId, error: error instanceof Error ? error.message : "Pipeline failure", diagnostic }));
      process.exitCode = 1;
    }
    const note = await prisma.note.findUniqueOrThrow({ where: { id: noteId },
      include: { aiRuns: { where: { processingJobId: job.id } }, findings: { where: { status: "OPEN" } } } });
    after.push({ totalMs: Date.now() - startedAt, note });
    await save();
    console.log(JSON.stringify({ noteId, stage: note.processingStage, result: note.auditResult, totalMs: Date.now() - startedAt,
      findings: note.findings.map((finding) => finding.code),
      runs: note.aiRuns.map((aiRun) => ({ kind: aiRun.kind, model: aiRun.model, status: aiRun.status, latencyMs: aiRun.latencyMs })) }));
    if (note.processingStage !== "COMPLETED") process.exitCode = 1;
  }
  console.log(JSON.stringify({ report: path, count: ids.length }));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Reprocessing failed."); process.exitCode = 1;
}).finally(() => prisma.$disconnect());

import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../src/server/db/prisma";
import { matchesGenerationModel } from "../src/server/integrations/openrouter/generation-metadata";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";

const count = z.number().int().nonnegative().nullable().optional();
const generationSchema = z.object({ data: z.object({
  id: z.string().max(160), model: z.string().max(160), provider_name: z.string().max(160).nullable().optional(),
  cancelled: z.boolean().nullable().optional(), streamed: z.boolean().nullable().optional(),
  finish_reason: z.string().max(80).nullable().optional(), native_finish_reason: z.string().max(80).nullable().optional(),
  latency: count, generation_time: count, moderation_latency: count,
  native_tokens_prompt: count, native_tokens_completion: count, native_tokens_reasoning: count,
  total_cost: z.number().nonnegative().nullable().optional(),
}) });

/** One read-only metadata request, never a new model generation or database update. */
async function main() {
  assertIsolatedHarnessTargets();
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === "--run-id", "Supply --run-id and one isolated AI run ID.");
  const run = await prisma.aiRun.findFirstOrThrow({ where: { id: args[1], note: { work: { code: "LOCAL-104" } } },
    select: { id: true, model: true, structuredResponse: true } });
  const stored = run.structuredResponse as Record<string, unknown> | null;
  const generationId = stored?.generationId;
  assert(typeof generationId === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(generationId), "No usable generation ID was recorded.");
  assert(process.env.OPENROUTER_API_KEY, "Existing OpenRouter credential is required.");
  const url = new URL("https://openrouter.ai/api/v1/generation");
  url.searchParams.set("id", generationId);
  const report: Record<string, unknown> = { scope: "READ_ONLY_PROVIDER_METADATA_NO_NEW_GENERATION", runId: run.id, observedAt: new Date().toISOString() };
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(5000) });
    report.httpStatus = response.status;
    if (response.ok) {
      const parsed = generationSchema.safeParse(await response.json());
      if (!parsed.success) report.validationIssues = parsed.error.issues.map(issue => ({ path: issue.path.join("."), code: issue.code }));
      assert(parsed.success, "Generation metadata did not pass its safe schema.");
      report.generation = parsed.data.data;
      report.identityMatch = { generation: parsed.data.data.id === generationId, model: matchesGenerationModel(parsed.data.data.model, run.model) };
      assert.equal(parsed.data.data.id, generationId, "Generation ID mismatch.");
      assert(matchesGenerationModel(parsed.data.data.model, run.model), "Generation model mismatch.");
    }
  } catch (error) {
    report.error = { name: error instanceof Error ? error.name : "MetadataError",
      reason: error instanceof assert.AssertionError ? error.message : undefined };
    process.exitCode = 1;
  }
  await mkdir(resolve("tmp"), { recursive: true });
  const path = resolve("tmp", `generation-${run.id}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path, ...report }));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Generation inspection failed."); process.exitCode = 1;
}).finally(() => prisma.$disconnect());

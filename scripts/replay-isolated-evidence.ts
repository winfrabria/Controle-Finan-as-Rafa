import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { applyEvidenceRepairWithTrace } from "../src/lib/integrations/openrouter/evidence-repair";
import { getContextOnlyCoverageGaps, getEvidenceCoverageLimitation } from "../src/lib/integrations/openrouter/evidence-coverage";
import { getInvoiceExtractionLimitation } from "../src/server/integrations/openrouter/client";

/** Offline semantic regression only: no document reread, provider call or database mutation. */
async function main() {
  const [input, pageArgument] = process.argv.slice(2);
  assert(input && pageArgument, "Supply the saved extraction JSON and original page count.");
  const path = resolve(input);
  assert(path.startsWith(resolve("tmp") + sep) && path.endsWith(".json"), "Use a private snapshot under tmp.");
  const expectedPages = Number(pageArgument);
  assert(Number.isSafeInteger(expectedPages) && expectedPages > 0);
  const saved = JSON.parse(await readFile(path, "utf8"));
  const parsed = parseInvoiceExtractionPayload(saved.result?.data);
  assert(parsed.success, "Snapshot does not contain a valid extraction.");
  const base = parsed.data;
  const before = structuredClone(base);
  const records = [...base.items.flatMap(item => item.evidenceObservations.map(observation => ({
    line: item.lineNumber, observation,
  }))), ...(base.documentObservations ?? []).map(observation => ({ line: null, observation }))]
    .map(({ line, observation }) => ({ line, kind: observation.kind, scope: observation.amountScope ?? "UNKNOWN",
      amount: observation.amount, date: observation.date, page: observation.page, quote: observation.text }));
  const result = applyEvidenceRepairWithTrace(base, { pages: base.pageCoverage, records,
    supportCoverage: base.supportCoverage, requiredFieldChecks: base.requiredFieldChecks,
    unmappedItemCount: 0, warnings: [] }, expectedPages);
  assert.deepEqual(base, before, "Replay must not mutate the source snapshot.");
  const limitation = (data: typeof base) => getInvoiceExtractionLimitation(data, "application/pdf") ??
    getEvidenceCoverageLimitation(data, expectedPages);
  console.log(JSON.stringify({ mode: "OFFLINE_SAVED_OBSERVATIONS", independentVisualRead: false,
    databaseMutated: false, providerCalls: 0, before: limitation(base),
    contextOnlyCoverageGaps: getContextOnlyCoverageGaps(base, expectedPages),
    replayAccepted: Boolean(result), after: result ? limitation(result.data) : null,
    itemCount: result?.data.items.length,
    corrections: result?.corrections.map(({ lineNumber, sourceKind, sourcePage, field, previousValue, repairedValue, basis }) =>
      ({ lineNumber, sourceKind, sourcePage, field, previousValue, repairedValue, basis })),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Offline replay failed.");
  process.exitCode = 1;
});

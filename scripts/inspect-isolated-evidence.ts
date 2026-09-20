import "dotenv/config";
import assert from "node:assert/strict";
import { evaluateHarness, HARNESS_VERSIONS } from "../src/lib/audit-harness";
import { parseInvoiceExtractionPayload } from "../src/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "../src/lib/integrations/openrouter/evidence-coverage";
import { prisma } from "../src/server/db/prisma";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";

/** Read-only diagnosis of stored evidence; never calls a model or edits a note. */
async function main() {
  assertIsolatedHarnessTargets();
  const [noteId, lineArgument] = process.argv.slice(2);
  const lineNumber = Number(lineArgument);
  assert(noteId && Number.isSafeInteger(lineNumber) && lineNumber > 0,
    "Supply a local note ID and positive item line number.");
  const note = await prisma.note.findFirstOrThrow({ where: { id: noteId, work: { code: "LOCAL-104" } },
    select: { id: true, version: true, extractedData: true, originalFileSha256: true, originalPageCount: true } });
  const parsed = parseInvoiceExtractionPayload(note.extractedData);
  assert(parsed.success, "Stored extraction is not valid under the current contract.");
  const invoice = { ...parsed.data, originalFileSha256: note.originalFileSha256 };
  const item = invoice.items.find(row => row.lineNumber === lineNumber);
  assert(item, "Line not found.");
  const pages = new Set([item.sourcePage, ...item.evidenceObservations.map(source => source.page)]);
  const result = evaluateHarness({ invoice });
  console.log(JSON.stringify({ mode: "READ_ONLY_STORED_EVIDENCE", providerCalls: 0, versions: HARNESS_VERSIONS,
    noteId: note.id, noteVersion: note.version, originalFileSha256: note.originalFileSha256,
    item, pageCoverage: invoice.pageCoverage?.filter(page => pages.has(page.page)),
    documentObservations: invoice.documentObservations?.filter(source => pages.has(source.page)),
    supportCoverage: invoice.supportCoverage,
    coverageLimitation: getEvidenceCoverageLimitation(invoice, note.originalPageCount),
    localReplay: { classification: result.classification, findings: result.findings.map(finding =>
      ({ code: finding.code, lineNumber: finding.noteItemLineNumber, evidence: finding.evidence })) },
    markdown: invoice.markdown,
    limitations: ["Replay uses stored extraction, not an independent visual reread.",
      "No fresh AI findings or work-rule context are included in localReplay."] }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Inspection failed");
  process.exitCode = 1; }).finally(() => prisma.$disconnect());

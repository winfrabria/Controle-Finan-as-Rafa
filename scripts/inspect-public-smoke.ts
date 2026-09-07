import { readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), true);

async function main() {
  const { prisma } = await import('../src/server/db/prisma');
  const results = JSON.parse(await readFile('tmp/public-invoice-smoke/http-results.json', 'utf8')) as { noteId: string }[];
  try {
    const notes = await prisma.note.findMany({
      where: { id: { in: results.map(r => r.noteId).filter(Boolean) } },
      select: { id: true, status: true, failureCode: true, failureMessage: true,
        extractedData: true, auditResult: true, assuranceBand: true, assuranceReason: true,
        findings: { select: { code: true, title: true, source: true, expectedValue: true, actualValue: true } },
        aiRuns: { select: { kind: true, status: true, model: true, provider: true,
          errorCode: true, errorMessage: true, latencyMs: true, costUsd: true,
          structuredResponse: true } },
        processingJobs: { select: { status: true, attempt: true, lastErrorCode: true } },
      },
    });
    // These IDs are restricted to our educational test uploads. Never export prompts,
    // source URLs with capabilities, raw model reasoning, user notes or credentials.
    const safe = notes.map(n => ({ ...n, aiRuns: n.aiRuns.map(r => {
      const data = r.structuredResponse as Record<string, unknown> | null;
      return { ...r, structuredResponse: undefined, diagnostics: data && {
        category: data.category, diagnostic: data.diagnostic, details: data.details,
        providerStatus: data.providerStatus, requestId: data.requestId,
        extractionReasoningEffort: data.extractionReasoningEffort,
        attemptTrace: data.attemptTrace, routing: data.routing,
      }};
    }) }));
    await writeFile('tmp/public-invoice-smoke/db-results.json', JSON.stringify(safe, null, 2));
    console.log(JSON.stringify(safe.map(n => {
      const extracted = n.extractedData as Record<string, unknown> | null;
      return { ...n, extractedData: extracted && { documentKind: extracted.documentKind,
        documentNumber: extracted.documentNumber, issuedAt: extracted.issuedAt,
        totalAmount: extracted.totalAmount, itemCoverage: extracted.itemCoverage,
        supportCoverage: extracted.supportCoverage, warnings: extracted.warnings,
        itemCount: Array.isArray(extracted.items) ? extracted.items.length : 0 } };
    }), null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Inspection failed'); process.exitCode = 1; });

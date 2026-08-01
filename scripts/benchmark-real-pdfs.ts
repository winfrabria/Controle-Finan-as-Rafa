import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateHarness,
  evaluateUniversalRules,
  evaluateWorkRules,
  type HarnessInvoice,
} from "@/lib/audit-harness";
import { getOpenRouterAuditDiscoveryClient, getOpenRouterInvoiceExtractionClient } from "@/server/integrations/openrouter";
import { prisma } from "@/server/db/prisma";
import {
  createInvoiceObjectPath,
  createInvoiceSignedUrl,
  removeInvoiceFile,
  uploadInvoiceFile,
} from "@/server/storage";

const files = [
  "Reembolso Roger  Costa - 551,90.pdf",
  "NF 5249 VEREDAS DA SERRA COMBUSTIVEL LTDA.pdf",
  "NF 5361 VEREDAS DA SERRA COMBUSTIVEL.pdf",
  "NF 352080 MEDEIROS E MOURA LTDA.pdf",
  "NFS-4 PABLA ALVES GOMES MARQUES.pdf",
] as const;

const sourceDirectory = "G:\\Downloads";
const resultPath = path.resolve("docs/harness/benchmarks/2026-08-01-real-pdfs.json");
const benchmarkLimit = Number.parseInt(process.env.BENCHMARK_LIMIT ?? "", 10);
const filesToBenchmark = Number.isFinite(benchmarkLimit) && benchmarkLimit > 0
  ? files.slice(0, benchmarkLimit)
  : files;

function completeness(invoice: HarnessInvoice) {
  const fields = [
    invoice.documentNumber,
    invoice.supplierName,
    invoice.supplierTaxId,
    invoice.issuedAt,
    invoice.totalAmount,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

async function main() {
  const work = await prisma.work.findFirst({
    where: { active: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!work) throw new Error("Nenhuma obra ativa disponível para o benchmark.");

  const extractionClient = getOpenRouterInvoiceExtractionClient();
  const auditClient = getOpenRouterAuditDiscoveryClient();
  const results: Array<Record<string, unknown>> = [];

  for (const fileName of filesToBenchmark) {
    const startedAt = Date.now();
    const noteId = randomUUID();
    const filePath = path.join(sourceDirectory, fileName);
    const storagePath = createInvoiceObjectPath({
      extension: "pdf",
      noteId,
      workId: work.id,
    });

    try {
      const bytes = await readFile(filePath);
      await uploadInvoiceFile({
        bytes,
        contentType: "application/pdf",
        fileName,
        noteId,
        path: storagePath,
        workId: work.id,
      });
      const { signedUrl } = await createInvoiceSignedUrl({
        expiresInSeconds: 15 * 60,
        path: storagePath,
      });
      const extraction = await extractionClient.extractInvoice({
        fileName,
        mimeType: "application/pdf",
        signedUrl,
      });
      const invoice = extraction.data;
      const universal = evaluateUniversalRules({ invoice, duplicates: [] });
      const workRules = evaluateWorkRules(invoice, []);
      const deterministicFindings = [...universal.findings, ...workRules.findings];
      const audit = await auditClient.discover({
        deterministicFindings,
        invoice,
        reasoningEffort: "max",
        workRules: [],
      });
      const evaluation = evaluateHarness({
        aiDiscovery: audit.data,
        invoice,
        workRules: [],
      });

      results.push({
        audit: {
          attempts: audit.attempts,
          classification: evaluation.classification,
          costUsd: audit.usage?.costUsd ?? null,
          findings: evaluation.findings.length,
          latencyMs: audit.latencyMs,
          model: audit.model,
          reasoningEffort: "max",
          totalTokens: audit.usage?.totalTokens ?? null,
        },
        extraction: {
          attempts: extraction.attempts,
          completenessPercent: completeness(invoice),
          costUsd: extraction.usage?.costUsd ?? null,
          itemCount: invoice.items.length,
          latencyMs: extraction.latencyMs,
          model: extraction.model,
          totalTokens: extraction.usage?.totalTokens ?? null,
          warningCount: invoice.warnings.length,
        },
        fileName,
        totalLatencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : "Erro desconhecido",
        fileName,
        totalLatencyMs: Date.now() - startedAt,
      });
    } finally {
      try {
        await removeInvoiceFile(storagePath);
      } catch {
        // Keep the benchmark result even if cleanup needs a manual retry.
      }
    }
  }

  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(
    resultPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Benchmark salvo em ${resultPath}`);
  console.log(JSON.stringify(results, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

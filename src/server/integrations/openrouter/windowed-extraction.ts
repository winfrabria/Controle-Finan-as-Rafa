import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { evidencePageRepairTarget, planPageWindows, remapWindowEvidence,
  replaceWindowPageEvidence } from "@/lib/integrations/openrouter/page-windows";
import { consolidationSourceIssue, type ExtractionWindow } from "@/lib/integrations/openrouter/window-consolidation";
import { getEvidenceCoverageLimitation, reconcileEvidenceInventory,
  reconcileUntracedSourceClaims } from "@/lib/integrations/openrouter/evidence-coverage";
import { getOpenRouterConfig } from "./config";
import { renderPdfPageImages } from "./pdf-page-images";
import { createExtractionCheckpoint, extractionCheckpointFingerprint, readExtractionCheckpoint } from "@/server/notes/extraction-checkpoint";
import { getInvoiceExtractionLimitation, OpenRouterClientError, OpenRouterInvoiceExtractionClient,
  type InvoiceExtractionAttempt, type InvoiceExtractionClient, type InvoiceExtractionRequest,
  type InvoiceExtractionResult, type InvoiceExtractionUsage } from "./client";

export type WindowExtractionEvent = { stage: "WINDOW" | "PAGE_REPAIR" | "CONSOLIDATION"; pages: number[]; result?: InvoiceExtractionResult;
  status: "STARTED" | "COMPLETED" | "FAILED";
  checkpoint?: ReturnType<typeof createExtractionCheckpoint>;
  failure?: { kind: string; diagnostic?: string }; originalSha256: string };
type Options = {
  originalSha256: string;
  config: ReturnType<typeof getOpenRouterConfig>;
  /** Durable observer is required: expensive page reads survive a later failure. */
  checkpoint: (event: WindowExtractionEvent) => Promise<void>;
  /** Explicit recovery input. Never searches disk or silently imports old runs. */
  savedWindows?: unknown[];
  createClient?: (timeoutMs: number) => InvoiceExtractionClient;
  renderPages?: typeof renderPdfPageImages;
  sleep?: (ms: number) => Promise<void>;
};

/** Experimental bounded route. Caller must explicitly opt in; ordinary uploads
 * retain their current route until this one passes real corpus acceptance. */
export class WindowedExtractionClient implements InvoiceExtractionClient {
  constructor(private readonly options: Options) {}

  async extractInvoice(request: InvoiceExtractionRequest): Promise<InvoiceExtractionResult> {
    if (request.mimeType !== "application/pdf" || request.visualWindows || !request.pageCount ||
      !request.signedUrl.startsWith("data:application/pdf;base64,") || request.signedUrl.length > 36_000_000) {
      throw new Error("Windowed extraction requires a bounded inline original PDF.");
    }
    const bytes = Buffer.from(request.signedUrl.slice("data:application/pdf;base64,".length), "base64");
    const originalSha256 = createHash("sha256").update(bytes).digest("hex");
    if (originalSha256 !== this.options.originalSha256) throw new Error("Original PDF identity changed.");
    const plan = planPageWindows(request.pageCount, 4, 8);
    const source = await PDFDocument.load(bytes);
    if (source.getPageCount() !== request.pageCount || source.getForm().getFields().length)
      throw new Error("PDF page count or interactive form is unsupported by the window route.");
    const startedAt = Date.now();
    const visual = this.options.config.visualPdfWindows;
    const deadline = startedAt + (visual ? 600_000 : 120_000);
    const results: Array<InvoiceExtractionResult | undefined> = new Array(plan.length);
    const fingerprint = (pages: number[]) => extractionCheckpointFingerprint({
      id: `window:${pages.join(",")}`, originalFileSha256: originalSha256,
      originalMimeType: request.mimeType, originalPageCount: request.pageCount!, claimedVersion: 0,
    }, this.options.config);
    const savedWindows = this.options.savedWindows ?? [];
    if (savedWindows.length > plan.length) throw new Error("Too many saved windows.");
    const savedWindowSchema = z.object({ stage: z.literal("WINDOW"), status: z.literal("COMPLETED"),
      originalSha256: z.literal(originalSha256), pages: z.array(z.number().int().positive()).min(1).max(4),
      checkpoint: z.unknown().refine(value => value !== undefined) });
    // Validate the entire recovery set before starting any paid work. Invalid or
    // stale cache input is an explicit failure, not permission to reread the PDF.
    for (const candidate of savedWindows) {
      const saved = savedWindowSchema.parse(candidate);
      const index = plan.findIndex(pages => JSON.stringify(pages) === JSON.stringify(saved.pages));
      if (index < 0 || results[index]) throw new Error("Unknown or duplicated saved window.");
      const recovered = readExtractionCheckpoint(saved.checkpoint, fingerprint(saved.pages));
      if (!recovered) throw new Error("Saved window contract or reader configuration changed.");
      const inventory = reconcileEvidenceInventory(recovered.data);
      const provenance = reconcileUntracedSourceClaims(inventory.data);
      remapWindowEvidence(provenance.data, saved.pages, request.pageCount);
      const currentLimitation = getInvoiceExtractionLimitation(provenance.data, "application/pdf", { windowFragment: true }) ??
        getEvidenceCoverageLimitation(provenance.data, saved.pages.length);
      results[index] = { ...recovered, data: provenance.data,
        ...(currentLimitation ? { qualityLimitation: currentLimitation } : { qualityLimitation: undefined }) };
    }
    const attemptTrace: InvoiceExtractionAttempt[] = [];
    const totals: InvoiceExtractionUsage = {};
    let next = 0, failed = false;
    let failure: unknown;
    const createClient = this.options.createClient ?? ((timeoutMs: number) => new OpenRouterInvoiceExtractionClient({
      ...this.options.config, timeoutMs, totalTimeoutMs: timeoutMs, maxAttempts: 1,
      extractionQualityGateEnabled: true,
    }));
    const account = (result: { attemptTrace?: InvoiceExtractionAttempt[]; usage?: InvoiceExtractionUsage }, pages: number[], stage: string) => {
      for (const entry of result.attemptTrace ?? []) attemptTrace.push({ ...entry, attempt: attemptTrace.length + 1,
        diagnosticDetails: { ...entry.diagnosticDetails, originalPages: pages, stage, originalSha256 } });
      for (const key of ["costUsd", "promptTokens", "completionTokens", "totalTokens"] as const) {
        const value = result.usage?.[key];
        if (value !== undefined) totals[key] = (totals[key] ?? 0) + value;
      }
    };
    const timeout = () => {
      const remaining = deadline - Date.now();
      if (remaining < 1000) throw new Error("Windowed extraction total deadline exhausted.");
      return Math.min(visual ? 180_000 : 45_000, remaining);
    };
    const createWindowRequest = async (pages: number[], fileName: string): Promise<InvoiceExtractionRequest> => {
      if (visual) {
        const pageImages = await (this.options.renderPages ?? renderPdfPageImages)(bytes, pages, request.pageCount!);
        return { fileName, mimeType: "application/pdf", pageCount: pages.length, signedUrl: "", pageImages,
          windowFragment: true };
      }
      const document = await PDFDocument.create();
      for (const page of await document.copyPages(source, pages.map(value => value - 1))) document.addPage(page);
      return { fileName, mimeType: "application/pdf", pageCount: pages.length, windowFragment: true,
        signedUrl: `data:application/pdf;base64,${Buffer.from(await document.save()).toString("base64")}` };
    };
    const readWindow = async () => {
      while (!failed && next < plan.length) {
        const index = next++, pages = plan[index];
        if (results[index]) continue;
        try {
          await this.options.checkpoint({ stage: "WINDOW", status: "STARTED", pages, originalSha256 });
          const windowRequest = await createWindowRequest(pages, visual ? "original-pages.pdf" : `window-${index + 1}.pdf`);
          const result = await createClient(timeout()).extractInvoice(windowRequest);
          account(result, pages, "WINDOW");
          results[index] = result;
          await this.options.checkpoint({ stage: "WINDOW", status: "COMPLETED", pages, result, originalSha256,
            checkpoint: createExtractionCheckpoint(result, fingerprint(pages)) });
        } catch (error) {
          failed = true; failure ??= error;
          if (error instanceof OpenRouterClientError) account(error, pages, "WINDOW");
          await this.options.checkpoint({ stage: "WINDOW", status: "FAILED", pages, originalSha256,
            failure: { kind: error instanceof OpenRouterClientError ? error.kind : "LOCAL_FAILURE",
              diagnostic: error instanceof OpenRouterClientError ? error.diagnostic : undefined } });
        }
      }
    };
    // Wait for in-flight work to settle even when another worker fails. Returning
    // early would lose cost telemetry and leave paid work orphaned.
    const settled = await Promise.allSettled([readWindow(), readWindow()]);
    for (const entry of settled) if (entry.status === "rejected") failure ??= entry.reason;
    const fail = (diagnostic: string) => new OpenRouterClientError("invalid-response",
      "A leitura por blocos não comprovou a consolidação completa.", false, undefined, undefined,
      { diagnostic, attempts: attemptTrace.length, attemptTrace, usage: totals,
        model: this.options.config.pdfModel, latencyMs: Date.now() - startedAt });
    if (failure || results.some(result => !result) || next !== plan.length) throw fail("window-read-incomplete");
    const repairIndexes = results.flatMap((result, index) =>
      evidencePageRepairTarget(result!.qualityLimitation, plan[index].length) ? [index] : []);
    let nextRepair = 0;
    const repairWindow = async () => {
      while (nextRepair < repairIndexes.length) {
        const index = repairIndexes[nextRepair++];
        const attemptedTargets = new Set<string>();
        while (true) {
          const target = evidencePageRepairTarget(results[index]!.qualityLimitation, plan[index].length);
          if (!target) break;
          const originalPage = plan[index][target.page - 1];
          const targetKey = `${target.page}:${target.kind}`;
          let repairResult: InvoiceExtractionResult | undefined;
          try {
            if (attemptedTargets.has(targetKey)) throw new Error("Focused page reread did not close the source deficit.");
            attemptedTargets.add(targetKey);
            await this.options.checkpoint({ stage: "PAGE_REPAIR", status: "STARTED", pages: [originalPage], originalSha256 });
            const repairRequest = { ...await createWindowRequest([originalPage], `page-${originalPage}-repair.pdf`),
              pageReviewScope: "SOURCE_INVENTORY" as const };
            let repair: InvoiceExtractionResult | undefined;
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                repair = await createClient(timeout()).extractInvoice(repairRequest);
                account(repair, [originalPage], "PAGE_REPAIR");
                break;
              } catch (error) {
                if (error instanceof OpenRouterClientError) account(error, [originalPage], "PAGE_REPAIR");
                const retryRateLimit = attempt === 1 && error instanceof OpenRouterClientError &&
                  error.kind === "provider" && error.status === 429 && error.retryable && !error.generationId;
                if (!retryRateLimit) throw error;
                const delay = Math.min(Math.max(error.retryAfterMs ?? 500, 0), 2_000);
                if (deadline - Date.now() <= delay + 1_000) throw error;
                await (this.options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms))))(delay);
              }
            }
            if (!repair) throw new Error("Focused page reread did not return a result.");
            repairResult = repair;
            const pageLocallyComplete = repair.data.pageCoverage?.length === 1 && repair.data.pageCoverage[0].page === 1 &&
              repair.data.pageCoverage[0].complete && repair.data.pageCoverage[0].fieldsReviewed &&
              repair.data.pageCoverage[0].sources.some(source => source.kind === target.kind) &&
              getEvidenceCoverageLimitation(repair.data, 1) === null;
            const completeDocumentFragment = repair.qualityLimitation?.diagnostic === "pdf-item-coverage-incomplete" &&
              repair.data.itemCoverage.status === "INCOMPLETE" && repair.data.itemCoverage.missingLineNumbers.length === 0 &&
              pageLocallyComplete;
            if ((repair.qualityLimitation && !completeDocumentFragment) ||
              (repair.data.itemCoverage.status !== "COMPLETE" && !completeDocumentFragment)) {
              throw new Error("Focused page reread remained incomplete.");
            }
            const mapped = remapWindowEvidence(repair.data, [target.page], plan[index].length);
            const oldPageItems = results[index]!.data.items.filter(item => item.sourcePage === target.page);
            const preserveReplacementEconomicLayer = oldPageItems.some(item => item.countsTowardDocumentTotal) ||
              (oldPageItems.length === 0 && target.kind === "FISCAL_LINE");
            const combined = replaceWindowPageEvidence(results[index]!.data, mapped, target.page,
              { preserveReplacementEconomicLayer, replacementItemCoverageComplete: true });
            if (!combined) throw new Error("Focused page reread did not close the source deficit.");
            const nextLimitation = getInvoiceExtractionLimitation(combined, "application/pdf", { windowFragment: true }) ??
              getEvidenceCoverageLimitation(combined, plan[index].length) ?? undefined;
            if (nextLimitation && !evidencePageRepairTarget(nextLimitation, plan[index].length)) {
              throw new Error("Focused page reread exposed an unsupported source deficit.");
            }
            const { qualityLimitation: _oldLimitation, ...baseResult } = results[index]!;
            void _oldLimitation;
            results[index] = { ...baseResult, data: combined,
              ...(nextLimitation ? { qualityLimitation: nextLimitation } : {}) };
            await this.options.checkpoint({ stage: "PAGE_REPAIR", status: "COMPLETED", pages: [originalPage],
              result: results[index], originalSha256 });
          } catch (error) {
            await this.options.checkpoint({ stage: "PAGE_REPAIR", status: "FAILED", pages: [originalPage], originalSha256,
              ...(repairResult ? { result: repairResult } : {}),
              failure: { kind: error instanceof OpenRouterClientError ? error.kind : "LOCAL_FAILURE",
                diagnostic: error instanceof OpenRouterClientError ? error.diagnostic : undefined } });
            break;
          }
        }
      }
    };
    await Promise.all([repairWindow(), repairWindow()]);
    let windows: ExtractionWindow[];
    try { windows = results.map((result, index) => ({ pages: plan[index],
      // A support/inventory warning in this fragment does not revoke the
      // independently declared coverage of its economic rows. Global gates
      // below still retain any real source gap after all pages are combined.
      itemCoverageComplete: result!.data.itemCoverage.status === "COMPLETE" &&
        result!.data.itemCoverage.missingLineNumbers.length === 0,
      data: remapWindowEvidence(result!.data, plan[index], request.pageCount!) })); }
    catch { throw fail("window-source-page-invalid"); }
    let consolidated: InvoiceExtractionResult | undefined;
    let associationRepair: InvoiceExtractionRequest["associationRepair"];
    for (let associationAttempt = 1; associationAttempt <= 2 && !consolidated; associationAttempt++) {
      try {
        const requestTimeout = timeout();
        await this.options.checkpoint({ stage: "CONSOLIDATION", status: "STARTED", pages: plan.flat(), originalSha256 });
        consolidated = await createClient(requestTimeout).extractInvoice({ ...request, signedUrl: "", visualWindows: windows,
          ...(associationRepair ? { associationRepair } : {}) });
        account(consolidated, plan.flat(), "CONSOLIDATION");
        await this.options.checkpoint({ stage: "CONSOLIDATION", status: "COMPLETED", pages: plan.flat(), result: consolidated, originalSha256 });
      } catch (error) {
        if (error instanceof OpenRouterClientError) account(error, plan.flat(), "CONSOLIDATION");
        const previousPlan = error instanceof OpenRouterClientError && error.diagnostic === "window-association-plan-invalid" &&
          error.recoveryDraft ? (() => { try { return JSON.parse(error.recoveryDraft!); } catch { return null; } })() : null;
        const reason = error instanceof OpenRouterClientError && typeof error.diagnosticDetails?.reason === "string"
          ? error.diagnosticDetails.reason : "O schema ou a prova de associação não foi válido.";
        const canRepair = associationAttempt === 1 && previousPlan && deadline - Date.now() >= 5_000;
        if (canRepair) {
          associationRepair = { previousPlan, reason };
          await this.options.checkpoint({ stage: "CONSOLIDATION", status: "FAILED", pages: plan.flat(), originalSha256,
            failure: { kind: error instanceof OpenRouterClientError ? error.kind : "LOCAL_FAILURE",
              diagnostic: error instanceof OpenRouterClientError ? error.diagnostic : undefined } });
          continue;
        }
        throw fail("window-consolidation-failed");
      }
    }
    if (!consolidated) throw fail("window-consolidation-failed");
    const sourceIssue = consolidationSourceIssue(windows, consolidated.data);
    if (sourceIssue) throw fail(sourceIssue);
    const inventory = reconcileEvidenceInventory(consolidated.data);
    const provenance = reconcileUntracedSourceClaims(inventory.data);
    const qualityLimitation = getInvoiceExtractionLimitation(provenance.data, request.mimeType) ??
      getEvidenceCoverageLimitation(provenance.data, request.pageCount);
    return { ...consolidated, data: provenance.data,
      attempts: attemptTrace.length, attemptTrace, usage: totals, latencyMs: Date.now() - startedAt,
      ...(qualityLimitation ? { qualityLimitation } : { qualityLimitation: undefined }),
    };
  }
}

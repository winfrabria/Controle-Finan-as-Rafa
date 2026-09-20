import assert from "node:assert/strict";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";

/** A local replay cannot silently become another extraction/normalization. */
export function readLosslessExtractionSnapshot(snapshot: unknown) {
  const parsed = invoiceExtractionSchema.parse(snapshot);
  assert.deepEqual(parsed, snapshot, "Snapshot is not losslessly schema-valid; re-audit refused.");
  return parsed;
}

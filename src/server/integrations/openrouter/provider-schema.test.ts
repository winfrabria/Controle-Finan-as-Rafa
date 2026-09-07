import assert from "node:assert/strict";
import test from "node:test";
import { INVOICE_EXTRACTION_JSON_SCHEMA, invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { getProviderJsonSchema } from "./provider-schema";

test("Gemini recebe schema estrutural em ambas as rotas, sem alterar o contrato canônico", () => {
  const original = JSON.stringify(INVOICE_EXTRACTION_JSON_SCHEMA);
  for (const model of ["google/gemini-3.1-flash-lite", "google/gemini-3.7-flash"]) {
    const schema = getProviderJsonSchema(model, INVOICE_EXTRACTION_JSON_SCHEMA);
    assert.deepEqual(schema.required, INVOICE_EXTRACTION_JSON_SCHEMA.required);
    const text = JSON.stringify(schema);
    for (const key of ["maxItems", "minLength", "maxLength", "exclusiveMinimum", "minimum", "maximum"]) {
      assert.equal(text.includes(`"${key}":`), false);
    }
    assert.ok(text.includes('"additionalProperties":false'));
    assert.ok(text.includes('"SUPPORTING_DOCUMENT"'));
    assert.ok(text.includes('"sourceBoundingBox"'));
  }
  assert.equal(JSON.stringify(INVOICE_EXTRACTION_JSON_SCHEMA), original);
  assert.equal(getProviderJsonSchema("openai/gpt-5.6-terra", INVOICE_EXTRACTION_JSON_SCHEMA), INVOICE_EXTRACTION_JSON_SCHEMA);
});

test("limites locais continuam obrigatórios mesmo com schema de transporte estrutural", () => {
  const base = { markdown: "Documento legível", items: [], warnings: [], readConfidence: 0.9 };
  assert.ok(invoiceExtractionSchema.safeParse(base).success);
  assert.equal(invoiceExtractionSchema.safeParse({ ...base, readConfidence: 2 }).success, false);
  assert.equal(invoiceExtractionSchema.safeParse({ ...base, items: Array.from({ length: 501 }, (_, i) => ({ lineNumber: i + 1, description: "Item" })) }).success, false);
});

test("nomes de campos iguais a palavras de schema não são apagados", () => {
  const schema = getProviderJsonSchema("google/gemini-3.7-flash", { type: "object", properties: { maximum: { type: "number", minimum: 0 } } });
  assert.deepEqual(schema, { type: "object", properties: { maximum: { type: "number" } } });
});

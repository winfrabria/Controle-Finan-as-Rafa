// Gemini rejects this deeply nested extraction schema with HTTP 400 when its
// numeric/string/cardinality bounds are compiled together. Keep the transport
// schema structural; the unchanged local Zod contract enforces every bound.
// https://ai.google.dev/gemini-api/docs/structured-output#limitations
const LOCAL_VALIDATION_KEYWORDS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "minLength", "maxLength",
]);

function structuralSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  return Object.fromEntries(Object.entries(schema).flatMap(([key, value]) => {
    if (LOCAL_VALIDATION_KEYWORDS.has(key)) return [];
    if (key === "properties" || key === "$defs" || key === "definitions") {
      return [[key, Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .map(([name, child]) => [name, structuralSchema(child)]))]];
    }
    if (["items", "additionalProperties", "not"].includes(key)) return [[key, structuralSchema(value)]];
    if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(key) && Array.isArray(value)) {
      return [[key, value.map(structuralSchema)]];
    }
    return [[key, value]];
  }));
}

export function getProviderJsonSchema(model: string, schema: Record<string, unknown>): Record<string, unknown> {
  if (!/^google\/gemini-/i.test(model.trim())) return schema;
  return structuralSchema(schema) as Record<string, unknown>;
}

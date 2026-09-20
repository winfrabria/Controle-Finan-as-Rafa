import assert from "node:assert/strict";
import test from "node:test";
import { providerVerificationSchema } from "./provider-verification-schema";
import { VERIFICATION_WIRE_JSON_SCHEMA, parseVerificationWirePayload } from "./verification-wire";
import { validateVerificationCoverage } from "./verification";
import { FINDING_SOURCE_KINDS } from "./finding-source-observations";

const expected = [{ key: "line:1", lineNumber: 1, documentRole: "LINE_ITEM" as const, documentGroup: "a" }];
const valid = () => ({ status: "PASS", summary: "Conferência sintética.", findings: [], limitations: [],
  pageCoverage: { status: "COMPLETE", expectedPageCount: 1, checkedPages: [1], missingPages: [] },
  checks: [{ key: "line:1", state: "VERIFIED", findingCode: null, limitationCode: null,
    evidence: [{ page: 1, field: "valor", quote: "Total 10,00", source: "Original sintético" }] }] });

test("schema leve preserva campos, obrigatoriedade, tipos e enums sem mutar o original", () => {
  const before = structuredClone(VERIFICATION_WIRE_JSON_SCHEMA);
  const shape = providerVerificationSchema(VERIFICATION_WIRE_JSON_SCHEMA);
  const bounded = new Set(["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]);
  function compare(left: unknown, right: unknown, properties = false) {
    if (Array.isArray(left)) { assert(Array.isArray(right)); left.forEach((entry, i) => compare(entry, right[i])); assert.equal(left.length, right.length); return; }
    if (!left || typeof left !== "object") { assert.deepEqual(right, left); return; }
    const entries = Object.entries(left).filter(([key]) => properties || !bounded.has(key));
    assert.deepEqual(Object.keys(right as object), entries.map(([key]) => key));
    for (const [key, value] of entries) compare(value, (right as Record<string, unknown>)[key], key === "properties");
  }
  compare(VERIFICATION_WIRE_JSON_SCHEMA, shape);
  assert.deepEqual(VERIFICATION_WIRE_JSON_SCHEMA, before);
  assert(JSON.stringify(shape).length < JSON.stringify(before).length);
  assert.deepEqual(providerVerificationSchema({ properties: { maxItems: { type: "integer", minimum: 1 } } }),
    { properties: { maxItems: { type: "integer" } } });
});

test("limites continuam rejeitados no parser apesar do formato leve no provedor", () => {
  providerVerificationSchema(VERIFICATION_WIRE_JSON_SCHEMA);
  const tooLong = valid(); tooLong.summary = "a".repeat(4001);
  assert.equal(parseVerificationWirePayload(tooLong, expected).success, false);
  const tooMany = valid(); tooMany.checks = Array.from({ length: 301 }, () => tooMany.checks[0]);
  assert.equal(parseVerificationWirePayload(tooMany, expected).success, false);
  const wrongPage = valid(); wrongPage.checks[0].evidence[0].page = 0;
  assert.equal(parseVerificationWirePayload(wrongPage, expected).success, false);
  const missing = valid(); missing.checks = [];
  const parsed = parseVerificationWirePayload(missing, expected);
  assert(parsed.success);
  assert.equal(validateVerificationCoverage({ response: parsed.data, expectedChecks: expected, expectedPageCount: 1 }).complete, false);
});

test("schema do provedor limita evidence.source aos tipos canônicos", () => {
  const shape = providerVerificationSchema(VERIFICATION_WIRE_JSON_SCHEMA) as {
    properties: { checks: { items: { properties: { evidence: { items: { properties: { source: { enum: readonly string[] } } } } } } } };
  };
  assert.deepEqual(shape.properties.checks.items.properties.evidence.items.properties.source.enum, FINDING_SOURCE_KINDS);
});

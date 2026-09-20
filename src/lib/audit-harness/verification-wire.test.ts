import assert from "node:assert/strict";
import test from "node:test";
import { parseVerificationWirePayload, VERIFICATION_WIRE_JSON_SCHEMA } from "./verification-wire";
import { validateVerificationCoverage, type VerificationCheckRequest } from "./verification";

const expected: VerificationCheckRequest[] = [{ key: "line:7", lineNumber: 7, documentGroup: "fiscal-A", documentRole: "LINE_ITEM" }];
function payload() {
  return { status: "PASS", summary: "Registro sintético conferido.", limitations: [], findings: [],
    pageCoverage: { checkedPages: [1], expectedPageCount: 1, missingPages: [], status: "COMPLETE" },
    checks: [{ key: "line:7", state: "VERIFIED", findingCode: null, limitationCode: null,
      evidence: [{ page: 1, field: "total", quote: "Item 7: R$ 25,00.", source: "Original sintético" }] }] };
}

test("resposta compacta recompõe somente a identidade conhecida e preserva a evidência", () => {
  const source = payload();
  const result = parseVerificationWirePayload(source, expected);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.checks[0], { ...expected[0], ...source.checks[0] });
  assert.equal(validateVerificationCoverage({ response: result.data, expectedChecks: expected, expectedPageCount: 1 }).complete, true);
  assert.ok(JSON.stringify(source).length < JSON.stringify(result.data).length);
  assert.equal("lineNumber" in VERIFICATION_WIRE_JSON_SCHEMA.properties.checks.items.properties, false);
});

test("compactação não aceita chave desconhecida, repetida ou identidade injetada", () => {
  const unknown = payload(); unknown.checks[0].key = "line:8";
  assert.equal(parseVerificationWirePayload(unknown, expected).success, false);
  const duplicate = payload(); duplicate.checks.push(duplicate.checks[0]);
  assert.equal(parseVerificationWirePayload(duplicate, expected).success, false);
  const injected = payload(); Object.assign(injected.checks[0], { lineNumber: 8 });
  assert.equal(parseVerificationWirePayload(injected, expected).success, false);
});

test("compactação não inventa check, trecho nem cobertura ausente", () => {
  const missing = payload(); missing.checks = [];
  const result = parseVerificationWirePayload(missing, expected);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.checks.length, 0);
  assert.equal(validateVerificationCoverage({ response: result.data, expectedChecks: expected, expectedPageCount: 1 }).complete, false);
  const noEvidence = payload(); noEvidence.checks[0].evidence = [];
  const empty = parseVerificationWirePayload(noEvidence, expected);
  assert.equal(empty.success, true);
  if (!empty.success) return;
  assert.equal(validateVerificationCoverage({ response: empty.data, expectedChecks: expected, expectedPageCount: 1 }).complete, false);
});

test("check pode citar mais de vinte fontes sem invalidar um documento grande", () => {
  const source = payload();
  source.checks[0].evidence = Array.from({ length: 23 }, (_, index) => ({
    page: index + 1,
    field: "cobertura",
    quote: `Página ${index + 1} conferida no documento sintético.`,
    source: "OTHER",
  }));
  source.pageCoverage = { checkedPages: Array.from({ length: 23 }, (_, index) => index + 1),
    expectedPageCount: 23, missingPages: [], status: "COMPLETE" };
  assert.equal(parseVerificationWirePayload(source, expected).success, true);
  source.checks[0].evidence = Array.from({ length: 501 }, (_, index) => ({
    page: index + 1, field: "cobertura", quote: `Fonte sintética ${index + 1}.`, source: "OTHER",
  }));
  assert.equal(parseVerificationWirePayload(source, expected).success, false);
});

test("compactação preserva as restrições de status e de achado do contrato completo", () => {
  const limited = payload(); limited.status = "LIMITED";
  assert.equal(parseVerificationWirePayload(limited, expected).success, false);
  const finding = payload(); finding.checks[0].state = "FINDING";
  assert.equal(parseVerificationWirePayload(finding, expected).success, false);
});

function findingPayload() {
  return { ...payload(), status: "FINDINGS", findings: [{ code: "SYNTHETIC_CONFLICT", confirmsInitialFindingCode: null,
    title: "Conflito sintético", description: "Fontes sintéticas divergentes", category: "VALUE", severity: "WARNING",
    source: "AI_VERIFICATION", confidence: 0.9, justification: "Confronto de duas fontes do documento", references: [] as string[],
    actualValue: "25,00 e 27,00", expectedValue: null, noteItemLineNumber: 7, comparisonMode: "CONFLICT", referenceBasis: null,
    evidence: { field: "amount", page: 1, lineNumber: 7, source: "Documento original", summary: "Valores divergentes",
      claimScope: "DOCUMENT_CONTENT" as string | null, observations: [
        { kind: "RECEIPT", label: "Recibo", page: 1, text: "R$ 25,00", value: "25.00" },
        { kind: "PAYMENT", label: "Pagamento", page: 2, text: "R$ 27,00", value: "27.00" },
      ] } }] };
}

test("referências locais vazias são derivadas das páginas da evidência validada, sem alterar o payload", () => {
  const source = findingPayload(); const before = structuredClone(source);
  const result = parseVerificationWirePayload(source, expected);
  assert.ok(result.success); if (!result.success) return;
  assert.deepEqual(result.data.findings[0].references, ["Documento original · página 1", "Documento original · página 2"]);
  assert.deepEqual(source, before);
  assert.deepEqual(result.data.findings[0].evidence, source.findings[0].evidence);
  // Materializing a link is not approval: missing check linkage/page coverage
  // must still fail the independent coverage gate.
  assert.equal(validateVerificationCoverage({ expectedChecks: expected, expectedPageCount: 2, response: result.data }).complete, false);
});

test("referência já fornecida é preservada e autorização não ganha regra inventada", () => {
  const source = findingPayload(); source.findings[0].references = ["Referência explicitamente fornecida"];
  const result = parseVerificationWirePayload(source, expected);
  assert.ok(result.success); if (!result.success) return;
  assert.deepEqual(result.data.findings[0].references, source.findings[0].references);
  for (const scope of ["WORK_AUTHORIZATION", "ENTITY_IDENTITY", null]) {
    const value = findingPayload(); value.findings[0].evidence.claimScope = scope;
    assert.equal(parseVerificationWirePayload(value, expected).success, false);
  }
});

test("referência derivada nunca mascara evidência estruturalmente inválida", () => {
  const noPage = findingPayload(); noPage.findings[0].evidence.page = 0;
  assert.equal(parseVerificationWirePayload(noPage, expected).success, false);
  const noText = findingPayload(); noText.findings[0].evidence.observations[0].text = "";
  assert.equal(parseVerificationWirePayload(noText, expected).success, false);
  const noSource = findingPayload(); noSource.findings[0].evidence.source = "";
  assert.equal(parseVerificationWirePayload(noSource, expected).success, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { untracedObservationClaim } from "@/lib/integrations/openrouter/source-value-consistency";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { canRepairEvidenceInventory } from "@/lib/integrations/openrouter/evidence-repair";
import { INVOICE_EXTRACTION_JSON_SCHEMA, parseInvoiceExtractionPayload } from "@/lib/integrations/openrouter/extraction-contract";
import { nativeExtractionSchema } from "@/lib/integrations/openrouter/native-extraction-schema";

test("schema nativo exige valores e datas no trecho, não apenas identificação da fonte", () => {
  const native = nativeExtractionSchema(INVOICE_EXTRACTION_JSON_SCHEMA);
  assert.match(JSON.stringify(native), /printed totalAmount and sourceDate/);
  assert.match(JSON.stringify(native), /quantity and unitPrice from this SAME row/);
  const schema = INVOICE_EXTRACTION_JSON_SCHEMA.properties;
  assert.match(schema.documentObservations.items.properties.text.description, /EVERY non-null amount and date/);
  assert.match(schema.items.items.properties.evidenceObservations.items.properties.text.description, /EVERY non-null amount and date/);
  assert.doesNotMatch(JSON.stringify(native), /Shortest useful visible excerpt/);
});

const claim = { amount: "1372.50", date: "2026-08-04", amountScope: "ITEM_TOTAL" };

test("trecho de fonte preserva valor brasileiro e data sem exigir uma transcrição da página", () => {
  assert.equal(untracedObservationClaim({ ...claim, text: "04/08/2026; total R$ 1.372,50" }), null);
  assert.equal(untracedObservationClaim({ ...claim, text: "2026-08-04 — 1372.50" }), null);
  assert.equal(untracedObservationClaim({ ...claim, text: "4/8/26, R$ 1372,50" }), null);
  assert.equal(untracedObservationClaim({ ...claim, text: "R$ 1372.50, em 04/08/2026." }), null);
  assert.equal(untracedObservationClaim({ ...claim, amount: "1000", text: "R$ 1.000; 04/08/2026" }), null);
});

test("nome do estabelecimento e data isolada não comprovam o valor no card", () => {
  assert.equal(untracedObservationClaim({ ...claim, text: "Estabelecimento sintético" }), "amount");
  assert.equal(untracedObservationClaim({ ...claim, amount: "4", text: "04/08/2026" }), "amount");
  assert.equal(untracedObservationClaim({ ...claim, text: null }), "amount");
});

test("valor correto com data omitida ou de outro dia não comprova a data extraída", () => {
  assert.equal(untracedObservationClaim({ ...claim, text: "Total 1372,50" }), "date");
  assert.equal(untracedObservationClaim({ ...claim, text: "03/08/2026; 1372,50" }), "date");
  assert.equal(untracedObservationClaim({ ...claim, text: "04/08/2025; 1372,50" }), "date");
});

test("campos nulos e fontes contextuais não exigem inventar números na citação", () => {
  assert.equal(untracedObservationClaim({ amount: null, date: null, text: "Assinatura sem preenchimento" }), null);
  assert.equal(untracedObservationClaim({ ...claim, date: null, text: "Total 1372,50" }), null);
  assert.equal(untracedObservationClaim({ ...claim, amountScope: "CONTEXT", text: "Referência documental" }), null);
});

function extraction() {
  const parsed = parseInvoiceExtractionPayload({ documentKind: "REIMBURSEMENT", totalAmount: "27",
    markdown: "Controle sintético com fonte explícita e todos os campos revisados.", readConfidence: 0.99,
    itemCoverage: { status: "COMPLETE", extractedItemCount: 1, firstLineNumber: 1, lastLineNumber: 1,
      declaredItemCount: 1, missingLineNumbers: [], evidence: "Uma linha preenchida" },
    items: [{ lineNumber: 1, description: "Despesa", sourceKind: "SHEET", sourceDate: "2026-08-04",
      sourcePage: 1, sourceText: "04/08/2026 — total R$ 27,00", totalAmount: "27", countsTowardDocumentTotal: true }],
    pageCoverage: [{ page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE",
      requirementEvidence: null, sources: [{ kind: "SHEET", count: 1 }] }],
    requiredFieldChecks: [],
  });
  assert.ok(parsed.success);
  return parsed.data;
}

test("obrigatoriedade explícita e escopo NONE da mesma página exigem releitura", () => {
  const data = extraction();
  data.requiredFieldChecks.push({ field: "purpose", label: "Finalidade", page: 1, present: false,
    requiredByDocument: true, requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: "Campo obrigatório",
    evidence: "Finalidade: área vazia", boundingBox: null });
  const before = structuredClone(data);
  const limitation = getEvidenceCoverageLimitation(data, 1);
  assert.equal(limitation?.diagnostic, "evidence-required-instruction-conflict");
  assert.deepEqual(data, before);
  assert.ok(canRepairEvidenceInventory(data, limitation?.diagnostic));
});

test("regra externa verificada não inventa instrução explícita no formulário", () => {
  const data = extraction();
  data.requiredFieldChecks.push({ field: "purpose", label: "Finalidade", page: 1, present: false,
    requiredByDocument: true, requirementBasis: "VERIFIED_POLICY", requirementEvidence: "Política fornecida",
    evidence: "Finalidade: área vazia", boundingBox: null });
  assert.equal(getEvidenceCoverageLimitation(data, 1), null);
});

test("fontes novas sem valor ou data no trecho ficam limitadas, sem alterar os valores", () => {
  const data = extraction();
  data.items[0].evidenceObservations[0].text = "Estabelecimento sintético";
  const limitation = getEvidenceCoverageLimitation(data, 1);
  assert.equal(limitation?.diagnostic, "evidence-source-claim-not-traceable");
  assert.equal(limitation?.details.field, "amount");
  assert.equal(data.items[0].totalAmount, "27");
  assert.ok(canRepairEvidenceInventory(data, limitation?.diagnostic));
});

test("snapshot histórico continua legível sem receber uma proveniência que não tinha", () => {
  const data = extraction();
  delete data.items[0].sourceKind;
  data.items[0].evidenceObservations[0].text = "Estabelecimento sintético";
  assert.equal(getEvidenceCoverageLimitation(data, 1), null);
});

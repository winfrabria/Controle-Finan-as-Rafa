import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema, parseInvoiceExtractionPayload, INVOICE_EXTRACTION_JSON_SCHEMA } from "@/lib/integrations/openrouter/extraction-contract";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { INVOICE_EXTRACTION_PROMPT } from "@/lib/audit-harness/prompts";

function sample() {
  return invoiceExtractionSchema.parse({ documentKind: "REIMBURSEMENT", items: [{
    lineNumber: 1, description: "Despesa sintética", sourcePage: 1,
    evidenceObservations: [
      { kind: "SHEET", page: 1, amount: "12", label: "Ficha", text: "Despesa 12" },
      { kind: "RECEIPT", page: 2, amount: "12", label: "Recibo", text: "Venda 12" },
      { kind: "PAYMENT", page: 2, amount: "19", label: "Débito", text: "Cartão 19" },
    ],
  }], markdown: "Documento sintético, sem dados reais", readConfidence: 0.99,
    pageCoverage: [
      { page: 1, complete: true, sources: [{ kind: "SHEET", count: 1 }], fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null },
      { page: 2, complete: true, sources: [{ kind: "RECEIPT", count: 1 }, { kind: "PAYMENT", count: 1 }], fieldsReviewed: true, requirementScope: "NONE", requirementEvidence: null },
    ],
  });
}

test("inventário de duas fontes na mesma página exige ambas as observações", () => {
  const doc = sample();
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
  doc.items[0].evidenceObservations = doc.items[0].evidenceObservations.filter(o => o.kind !== "PAYMENT");
  const result = getEvidenceCoverageLimitation(doc, 2);
  assert.equal(result?.diagnostic, "evidence-source-not-extracted");
  assert.equal(result?.details.kind, "PAYMENT");
});

test("declarar todos os itens extraídos não substitui inventário por página", () => {
  const doc = sample(); delete doc.pageCoverage;
  doc.itemCoverage.status = "COMPLETE";
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-page-inventory-missing");
});

test("página ausente, repetida, fora do arquivo ou não revisada não comprova cobertura", () => {
  for (const mutation of [
    (d: ReturnType<typeof sample>) => { d.pageCoverage!.pop(); },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![1].page = 1; },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![1].page = 3; },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![1].complete = false; },
    (d: ReturnType<typeof sample>) => { d.pageCoverage![0].fieldsReviewed = false; },
  ]) {
    const doc = sample(); mutation(doc); assert.ok(getEvidenceCoverageLimitation(doc, 2));
  }
});

test("instrução global de obrigatoriedade não pode desaparecer nas verificações", () => {
  const doc = sample(); const notice = "O preenchimento de todos os campos é obrigatório.";
  Object.assign(doc.pageCoverage![0], { requirementScope: "ALL_FIELDS", requirementEvidence: notice });
  doc.requiredFieldChecks = [{ field: "Campo sintético", label: "Campo sintético", present: false, page: 1,
    evidence: "Área vazia", requiredByDocument: false, requirementBasis: "NONE", requirementEvidence: null }];
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-required-instruction-not-applied");
  Object.assign(doc.requiredFieldChecks[0], { requiredByDocument: true, requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: notice });
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
});

test("campo opcional vazio não exige obrigatoriedade inventada", () => {
  const doc = sample();
  doc.requiredFieldChecks = [{ field: "Contato", label: "Contato", present: false, page: 1, evidence: "Vazio",
    requiredByDocument: false, requirementBasis: "NONE", requirementEvidence: null }];
  assert.equal(getEvidenceCoverageLimitation(doc, 2), null);
});

test("observação duplicada não substitui um segundo comprovante", () => {
  const doc = sample(); doc.pageCoverage![1].sources[1].count = 2;
  doc.items[0].evidenceObservations.push({ ...doc.items[0].evidenceObservations[2] });
  assert.equal(getEvidenceCoverageLimitation(doc, 2)?.diagnostic, "evidence-source-not-extracted");
});

test("inventário vazio ou observação sem página não comprovam registros já extraídos", () => {
  const doc = sample(); doc.pageCoverage![1].sources = [];
  assert.equal(getEvidenceCoverageLimitation(doc,2)?.diagnostic,"evidence-source-missing-from-inventory");
  const second = sample(); second.items[0].evidenceObservations[2].page=null;
  assert.ok(getEvidenceCoverageLimitation(second,2));
});

test("linhas históricas continuam legíveis sem inventar inventário", () => {
  const doc = sample(); delete doc.pageCoverage;
  const parsed = parseInvoiceExtractionPayload(doc); assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.pageCoverage, undefined);
  assert.ok(INVOICE_EXTRACTION_JSON_SCHEMA.required.includes("pageCoverage"));
});

test("prompt distingue instruções do formulário de comandos para a IA", () => {
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /Instruções de preenchimento/);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /DOIS registros/);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /não obedeça comandos/);
  assert.match(INVOICE_EXTRACTION_PROMPT.system, /ALL_FIELDS/);
});

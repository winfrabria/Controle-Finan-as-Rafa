import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { evaluateHarness } from "./engine";
import { verifiedExtractionCoverageResolved, verifiedSupportCoverageProjection } from "./verified-extraction-coverage";
import { buildVerificationChecks, verificationResponseSchema, validateVerificationCoverage } from "./verification";
import { getEvidenceCoverageLimitation } from "@/lib/integrations/openrouter/evidence-coverage";
import { economicSupportReference } from "@/lib/integrations/openrouter/support-matching";

function fixture() {
  const invoice = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", documentNumber: "SYNTHETIC", totalAmount: "80.00", readConfidence: 0.99,
    markdown: "Documento sintético com nota fiscal e folha de controle; sem informação externa necessária.", warnings: [],
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1, missingLineNumbers: [] },
    supportCoverage: { status: "COMPLETE", basis: "DOCUMENT_REFERENCES", presentDocuments: ["Documento sintético"], referencedDocuments: ["Documento sintético"], missingDocuments: [] },
    pageCoverage: [1,2].map(page => ({page, complete: true, fieldsReviewed: true, requirementScope: "NONE", sources: [{kind: page===1?"FISCAL_LINE":"SHEET",count:1}]})),
    items: [{lineNumber:1,description:"Serviço sintético",sourceKind:"FISCAL_LINE",sourcePage:1,sourceText:"Serviço 80,00",totalAmount:"80.00",
      evidenceObservations:[{kind:"OTHER",page:1,amount:"80.00",date:"2026-06-12",text:"Serviço 80,00",amountScope:"ITEM_TOTAL"}]}],
    documentObservations:[{kind:"SHEET",page:2,amount:"80.00",text:"Total 80,00",amountScope:"DOCUMENT_TOTAL"}] });
  const checks = buildVerificationChecks(invoice);
  const evidence = [{page:1,source:"FISCAL_LINE",field:"valor",quote:"Serviço 80,00"},
    {page:1,source:"OTHER",field:"data e valor",quote:"Emissão 12/06/2026. Total 80,00"},
    {page:2,source:"SHEET",field:"valor",quote:"Total 80,00"}];
  const response = verificationResponseSchema.parse({status:"PASS",summary:"Conferência sintética sem divergência.",findings:[],limitations:[],
    pageCoverage:{status:"COMPLETE",expectedPageCount:2,checkedPages:[1,2],missingPages:[]},
    checks:checks.map(check=>({key:check.key,lineNumber:check.lineNumber,documentGroup:check.documentGroup,documentRole:check.documentRole ?? null,
      state:"VERIFIED",evidence,findingCode:null,limitationCode:null,
      comparison: check.amountPair ? {outcome:"CONSISTENT",basis:"Totais iguais em fontes conferidas",leftEvidenceIndex:0,rightEvidenceIndex:1}:null})) });
  return {invoice,response,pageCount:2,coverageComplete:validateVerificationCoverage({expectedChecks:checks,expectedPageCount:2,response}).complete};
}

function selfContainedSupportFixture() {
  const invoice = invoiceExtractionSchema.parse({ documentKind: "COMPOSITE", documentNumber: "SYNTHETIC",
    totalAmount: "80.00", readConfidence: 0.99, markdown: "Nota fiscal e boleto no mesmo anexo.", warnings: [],
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [] },
    supportCoverage: { status: "UNKNOWN", basis: "NONE", evidence: null, referencedDocuments: ["NF-e 123"],
      presentDocuments: ["NF-e 123", "Boleto"], missingDocuments: [] },
    pageCoverage: [
      { page: 1, complete: true, fieldsReviewed: true, requirementScope: "NONE", sources: [{ kind: "FISCAL_LINE", count: 1 }] },
      { page: 2, complete: true, fieldsReviewed: true, requirementScope: "NONE", sources: [{ kind: "CHARGE", count: 1 }] },
    ],
    items: [
      { lineNumber: 1, description: "Serviço", sourceKind: "FISCAL_LINE", sourcePage: 1,
        sourceText: "Serviço 80,00", totalAmount: "80.00", countsTowardDocumentTotal: true, documentRole: "LINE_ITEM" },
      { lineNumber: 2, description: "Boleto", sourceKind: "CHARGE", sourcePage: 2,
        sourceText: "Valor do boleto 80,00", totalAmount: "80.00", countsTowardDocumentTotal: false,
        documentRole: "AGGREGATE_PAYMENT", evidenceObservations: [
          { kind: "CHARGE", page: 2, amount: "80.00", text: "Valor do boleto 80,00", amountScope: "DOCUMENT_TOTAL" },
        ] },
    ] });
  const checks = buildVerificationChecks(invoice);
  const evidence = [
    { page: 1, source: "FISCAL_LINE", field: "valor", quote: "Serviço 80,00" },
    { page: 2, source: "CHARGE", field: "valor", quote: "Valor do boleto 80,00" },
  ];
  const response = verificationResponseSchema.parse({ status: "PASS", summary: "Todas as páginas e referências foram conferidas.",
    findings: [], limitations: [], pageCoverage: { status: "COMPLETE", expectedPageCount: 2,
      checkedPages: [1, 2], missingPages: [] }, checks: checks.map(check => ({ key: check.key,
      lineNumber: check.lineNumber, documentGroup: check.documentGroup, documentRole: check.documentRole ?? null,
      state: "VERIFIED", evidence, findingCode: null, limitationCode: null,
      comparison: check.amountPair ? { outcome: "CONSISTENT", basis: "Valores conferidos nas duas fontes.",
        leftEvidenceIndex: 0, rightEvidenceIndex: 1 } : null })) });
  return { invoice, response, coverageComplete: validateVerificationCoverage({ expectedChecks: checks,
    expectedPageCount: 2, response }).complete };
}

test("verificação completa resolve fonte extra e data sem trecho sem alterar extração",()=>{
  const input=fixture(), before=structuredClone(input);
  assert.equal(input.coverageComplete,true);
  assert.equal(verifiedExtractionCoverageResolved(input),true);
  assert.deepEqual(input,before);
});

test("falha, fonte errada, valor errado e data ausente não resolvem a lacuna",()=>{
  for(const scenario of ["coverage","source","amount","date"]){
    const input=fixture();
    if(scenario==="coverage") input.coverageComplete=false;
    for(const check of input.response.checks){
      if(scenario==="source") check.evidence[1].source="PAYMENT";
      if(scenario==="amount") check.evidence[1].quote="Emissão 12/06/2026. Total 79,00";
      if(scenario==="date") check.evidence[1].quote="Total 80,00";
    }
    assert.equal(verifiedExtractionCoverageResolved(input),false,scenario);
  }
});

test("reembolso ainda exige cobertura dos comprovantes referenciados", () => {
  const input = fixture();
  input.invoice.documentKind = "REIMBURSEMENT";
  input.invoice.supportCoverage!.status = "UNKNOWN";
  assert.equal(verifiedExtractionCoverageResolved(input), false);
});

test("fonte declarada faltante não é preenchida com a confirmação de outra fonte",()=>{
  const input=fixture(); input.invoice.pageCoverage![1].sources[0].count=2;
  assert.equal(verifiedExtractionCoverageResolved(input),false);
});

test("verificação integral fecha somente inventário OTHER de observação documental já rastreável", () => {
  const input = fixture();
  input.invoice.items[0].evidenceObservations = [];
  input.invoice.documentObservations = [{ kind: "OTHER", page: 1, documentGroup: null, label: null,
    amount: "80.00", date: "2026-06-12",
    text: "Emissão 12/06/2026. Total 80,00", amountScope: "DOCUMENT_TOTAL" },
    ...input.invoice.documentObservations!];
  for (const check of input.response.checks) {
    check.evidence[1].source = "FISCAL_LINE";
  }
  const before = structuredClone(input.invoice);
  assert.equal(getEvidenceCoverageLimitation(input.invoice, 2)?.diagnostic, "evidence-source-missing-from-inventory");
  assert.equal(verifiedExtractionCoverageResolved(input), true);
  assert.deepEqual(input.invoice, before);
  for (const scenario of ["no-coverage-proof", "wrong-page", "untraced", "duplicate"] as const) {
    const changed = structuredClone(input);
    const coverage = changed.response.checks.find(check => check.key === "document:coverage")!;
    if (scenario === "no-coverage-proof") coverage.state = "LIMITATION";
    if (scenario === "wrong-page") coverage.evidence.forEach(evidence => { evidence.page = 2; });
    if (scenario === "untraced") changed.invoice.documentObservations![0].text = "Cabeçalho sem valores";
    if (scenario === "duplicate") changed.invoice.documentObservations!.push(structuredClone(changed.invoice.documentObservations![0]));
    assert.equal(verifiedExtractionCoverageResolved(changed), false, scenario);
  }
});

test("trecho primário sem data usa confirmação da mesma linha e fonte, sem editar o original", () => {
  const input = fixture();
  input.invoice.items[0].sourceDate = "2026-06-12";
  input.invoice.items[0].sourceKind = "SHEET";
  input.invoice.pageCoverage![0].sources[0].kind = "SHEET";
  input.invoice.items[0].evidenceObservations.push({kind:"SHEET",page:1,amount:"80.00",date:"2026-06-12",text:"Emissão 12/06/2026. Serviço 80,00",documentGroup:null,label:null});
  for (const check of input.response.checks) { check.evidence[0].quote = "Emissão 12/06/2026. Serviço 80,00"; check.evidence[0].source = "SHEET"; }
  const before = structuredClone(input.invoice);
  assert.equal(verifiedExtractionCoverageResolved(input), true);
  assert.deepEqual(input.invoice, before);
  for (const scenario of ["amount", "date", "page", "kind", "different-row", "limitation"]) {
    const changed = structuredClone(input);
    const check = changed.response.checks.find(check => check.key === "line:1")!;
    if (scenario === "amount") check.evidence[0].quote = "Emissão 12/06/2026. Serviço 79,00";
    if (scenario === "date") check.evidence[0].quote = "Emissão 13/06/2026. Serviço 80,00";
    if (scenario === "page") check.evidence[0].page = 2;
    if (scenario === "kind") check.evidence[0].source = "PAYMENT";
    if (scenario === "different-row") check.key = "line:2";
    if (scenario === "limitation") check.state = "LIMITATION";
    assert.equal(verifiedExtractionCoverageResolved(changed), false, scenario);
  }
});

test("verificação completa fecha somente conjunto composto autossuficiente com referências presentes", () => {
  const input = selfContainedSupportFixture();
  const before = structuredClone(input.invoice);
  assert.equal(input.coverageComplete, true);
  assert.equal(evaluateHarness({ invoice: input.invoice }).classification, "INFORMATION_INSUFFICIENT");
  const projected = verifiedSupportCoverageProjection(input);
  assert.ok(projected);
  assert.equal(projected.supportCoverage?.status, "COMPLETE");
  assert.equal(evaluateHarness({ invoice: projected }).classification, "OK");
  assert.deepEqual(input.invoice, before);
});

test("verificação não promove suporte parcial, ausente, reembolso nem boleto sem prova rastreável", () => {
  for (const scenario of ["partial", "missing", "reimbursement", "wrong-proof", "no-reference"] as const) {
    const input = selfContainedSupportFixture();
    if (scenario === "partial") input.invoice.supportCoverage!.status = "PARTIAL";
    if (scenario === "missing") input.invoice.supportCoverage!.presentDocuments = ["Boleto"];
    if (scenario === "reimbursement") input.invoice.documentKind = "REIMBURSEMENT";
    if (scenario === "wrong-proof") input.response.checks.find(check => check.key === "line:2")!.evidence[1].quote = "Boleto sem valor";
    if (scenario === "no-reference") input.invoice.supportCoverage!.referencedDocuments = [];
    assert.equal(verifiedSupportCoverageProjection(input), null, scenario);
  }
});

test("verificação integral fecha apoio parcial somente quando liga explicitamente a linha econômica à fonte", () => {
  const input = selfContainedSupportFixture();
  input.invoice.documentKind = "REIMBURSEMENT";
  input.invoice.items[0].sourceKind = "SHEET";
  input.invoice.items[0].documentGroup = "ficha-1";
  input.invoice.items[1].sourceKind = "PAYMENT";
  input.invoice.items[1].documentRole = "SUPPORTING_DOCUMENT";
  input.invoice.items[1].documentGroup = "pagamento-1";
  const reference = economicSupportReference(input.invoice.items[0]);
  input.invoice.supportCoverage = { status: "PARTIAL", basis: "DOCUMENT_REFERENCES",
    referencedDocuments: [reference], presentDocuments: [], missingDocuments: [reference],
    evidence: "Uma fonte ainda não foi associada." };
  const check = input.response.checks.find(candidate => candidate.key === "line:1")!;
  check.state = "VERIFIED";
  check.evidence = [
    { page: 1, source: "SHEET", field: "valor", quote: "Serviço sintético 80,00" },
    { page: 2, source: "PAYMENT", field: "valor", quote: "Pagamento do serviço 80,00" },
  ];
  check.comparison = { outcome: "CONSISTENT", basis: "A linha e o pagamento tratam da mesma despesa.",
    leftEvidenceIndex: 0, rightEvidenceIndex: 1 };
  const projected = verifiedSupportCoverageProjection(input);
  assert.ok(projected);
  assert.equal(projected.supportCoverage?.status, "COMPLETE");
  assert.deepEqual(projected.supportCoverage?.missingDocuments, []);

  for (const scenario of ["unrelated", "wrong-amount", "wrong-line", "missing-declaration"] as const) {
    const changed = structuredClone(input);
    const proof = changed.response.checks.find(candidate => candidate.key === "line:1")!;
    if (scenario === "unrelated") proof.comparison!.outcome = "UNRELATED";
    if (scenario === "wrong-amount") proof.evidence[1].quote = "Pagamento do serviço 79,00";
    if (scenario === "wrong-line") proof.lineNumber = 2;
    if (scenario === "missing-declaration") changed.invoice.supportCoverage!.missingDocuments = [];
    assert.equal(verifiedSupportCoverageProjection(changed), null, scenario);
  }
});

function differentlyLabeledChargeDates() {
  const input = selfContainedSupportFixture();
  input.invoice.supportCoverage!.status = "COMPLETE";
  input.invoice.supportCoverage!.basis = "DOCUMENT_REFERENCES";
  const charge = input.invoice.items[1];
  charge.sourceDate = "2026-08-01";
  charge.sourceText = "Boleto 80,00 01/08/2026";
  charge.evidenceObservations[0].date = "2026-08-16";
  charge.evidenceObservations[0].text = "Vencimento 16/08/2026 Valor do Documento 80,00";
  const check = input.response.checks.find(candidate => candidate.key === "line:2")!;
  check.evidence = [
    { source: "CHARGE", page: 2, field: "data", quote: "Data de Emissão 01/08/2026" },
    { source: "CHARGE", page: 2, field: "data e valor", quote: "Vencimento 16/08/2026 Valor do Documento 80,00" },
  ];
  return { ...input, pageCount: 2 };
}

test("emissão e vencimento comprovados na mesma cobrança resolvem rótulo ausente sem mudar extração", () => {
  const input = differentlyLabeledChargeDates();
  const before = structuredClone(input);
  assert.equal(getEvidenceCoverageLimitation(input.invoice, 2)?.diagnostic, "evidence-primary-row-conflict");
  assert.equal(validateVerificationCoverage({ expectedChecks: buildVerificationChecks(input.invoice),
    expectedPageCount: 2, response: input.response }).complete, true);
  assert.equal(verifiedExtractionCoverageResolved(input), true);
  assert.deepEqual(input, before);
});

test("datas de cobrança só são conciliadas com papéis distintos e prova da mesma linha", () => {
  for (const scenario of ["same-role", "changed-primary-role", "changed-observed-role", "unlabeled", "wrong-date", "wrong-amount", "wrong-page", "wrong-source", "wrong-line", "limited", "amount-conflict"]) {
    const input = differentlyLabeledChargeDates();
    const check = input.response.checks.find(candidate => candidate.key === "line:2")!;
    if (scenario === "same-role") check.evidence[0].quote = "Vencimento 01/08/2026";
    if (scenario === "changed-primary-role") input.invoice.items[1].sourceText = "Vencimento 01/08/2026 Valor do Documento 80,00";
    if (scenario === "changed-observed-role") input.invoice.items[1].evidenceObservations[0].text = "Data de Emissão 16/08/2026 Valor do Documento 80,00";
    if (scenario === "unlabeled") check.evidence[0].quote = "01/08/2026";
    if (scenario === "wrong-date") check.evidence[0].quote = "Data de Emissão 02/08/2026";
    if (scenario === "wrong-amount") check.evidence[1].quote = "Vencimento 16/08/2026 Valor do Documento 79,00";
    if (scenario === "wrong-page") check.evidence[0].page = 1;
    if (scenario === "wrong-source") check.evidence[0].source = "FISCAL_LINE";
    if (scenario === "wrong-line") check.key = "line:999";
    if (scenario === "limited") check.state = "LIMITATION";
    if (scenario === "amount-conflict") input.invoice.items[1].evidenceObservations[0].amount = "79.00";
    assert.equal(verifiedExtractionCoverageResolved(input), false, scenario);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";
import { consolidationSourceIssue, materializeWindowAssociation, windowConsolidationPrompt, windowConsolidationRepairPrompt,
  windowAssociationPlanSchema, type ExtractionWindow,
  type WindowAssociationPlan } from "@/lib/integrations/openrouter/window-consolidation";

function windows(): ExtractionWindow[] {
  return [1, 2].map(page => ({ pages: [page], data: invoiceExtractionSchema.parse({ documentKind: "COMPOSITE",
    totalAmount: "100", markdown: `Página ${page}: serviço pedido ABC 100,00`, readConfidence: 0.9,
    items: [{ lineNumber: 7, description: "Serviço", sourceKind: "SHEET", sourcePage: page,
      sourceText: "Serviço pedido ABC 100,00", totalAmount: "100", documentGroup: "local-1", countsTowardDocumentTotal: true,
      evidenceObservations: [{ kind: "PAYMENT", amountScope: "DOCUMENT_TOTAL", amount: "100", page,
        text: "Pagamento pedido ABC 100,00", documentGroup: "local-1" }] }],
    documentObservations: [{ kind: "CHARGE", amountScope: "DOCUMENT_TOTAL", amount: "100", page,
      text: "Boleto pedido ABC 100,00", documentGroup: "local-1" }],
    requiredFieldChecks: [{ field: "signature", label: "Assinatura", present: false, requiredByDocument: true, page,
      requirementBasis: "EXPLICIT_DOCUMENT", requirementEvidence: "Assinatura obrigatória", evidence: "Assinatura vazia" }],
    pageCoverage: [{ page, complete: false, sources: [{ kind: "SHEET", count: 1 }], fieldsReviewed: true,
      requirementScope: "ALL_FIELDS", requirementEvidence: "Assinatura obrigatória" }],
    itemCoverage: { status: "INCOMPLETE", extractedItemCount: 1, missingLineNumbers: [] },
  }) }));
}
const plan = (): WindowAssociationPlan => ({ headerWindow: 1, economicItemRefs: ["w1:i1"], groups: [], parents: [] });
const proof = (a: string, b: string) => [a, b];

test("materialização mantém todas as ocorrências, campos e páginas sem reescrever ou modificar a entrada", () => {
  const input = windows(), before = structuredClone(input);
  const output = materializeWindowAssociation(input, plan(), 2).data;
  assert.deepEqual(input, before);
  assert.equal(output.items.length, 2);
  assert.deepEqual(output.items.map(item => item.lineNumber), [1, 2]);
  assert.deepEqual(output.items.map(item => item.countsTowardDocumentTotal), [true, false]);
  assert.deepEqual(output.items.map(item => item.documentGroup), ["window:1:local-1", "window:2:local-1"]);
  assert.equal(output.documentObservations?.length, 2);
  assert.equal(output.requiredFieldChecks.length, 2);
  assert.equal(output.pageCoverage?.length, 2);
  assert.equal(output.items[1].evidenceObservations[0].amountScope, "DOCUMENT_TOTAL");
  assert.equal(output.itemCoverage.status, "UNKNOWN");
  assert.equal(output.supportCoverage?.status, "UNKNOWN");
  assert.equal(consolidationSourceIssue(input, output), null);
  output.items[0].evidenceObservations[0].text = "alterado";
  assert.deepEqual(input, before);
});

test("referências desconhecidas, repetidas, de tipo errado e cabeçalho inventado são rejeitados", () => {
  for (const change of [ { economicItemRefs: ["w3:i1"] }, { economicItemRefs: ["w1:i1", "w1:i1"] },
    { economicItemRefs: ["w1:d1"] }, { headerWindow: 3 }, { totalAmount: "1" }, { items: [] } ]) {
    assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), ...change }, 2));
  }
});

test("vínculos referenciam duas fontes contextuais; modelo não recebe autoridade para reescrever citações", () => {
  const group = { refs: ["w1:i1", "w2:i1"], evidenceRefs: proof("w1:i1", "w2:i1") };
  const linked = materializeWindowAssociation(windows(), { ...plan(), groups: [group] }, 2).data;
  assert.equal(linked.items[0].documentGroup, linked.items[1].documentGroup);
  assert.equal(linked.itemCoverage.status, "UNKNOWN");
  for (const evidenceRefs of [proof("w1:i1", "w1:i1"), proof("w1:i1", "w1:d1"), proof("w1:i1", "w3:i1")]) {
    assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), groups: [{ ...group, evidenceRefs }] }, 2));
  }
  const numericOnly = windows(); numericOnly[0].data.items[0].sourceText = "100,00";
  assert.throws(() => materializeWindowAssociation(numericOnly, { ...plan(), groups: [group] }, 2));
  assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), groups: [{ ...group,
    evidence: [{ ref: "w1:i1", quote: "inventado" }] }] }, 2));
  assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), groups: [group, group] }, 2));
});

test("grupo unitário é neutro e prova de grupo acompanha o mesmo limite de fontes", () => {
  const singleton = { refs: ["w1:i1"], evidenceRefs: ["w1:i1"] };
  const output = materializeWindowAssociation(windows(), { ...plan(), groups: [singleton] }, 2).data;
  assert.equal(output.items[0].documentGroup, "window:1:local-1");
  const repeatedMembers = Array.from({ length: 21 }, (_, index) => {
    const input = structuredClone(windows()[0].data.items[0]);
    input.lineNumber = index + 1;
    input.sourceText = `Serviço pedido ABC linha ${index + 1}`;
    return input;
  });
  const large: ExtractionWindow[] = [{ pages: [1], data: invoiceExtractionSchema.parse({ ...windows()[0].data,
    items: repeatedMembers, requiredFieldChecks: [], documentObservations: [] }) }];
  const refs = repeatedMembers.map((_, index) => `w1:i${index + 1}`);
  const linked = materializeWindowAssociation(large, { headerWindow: 1, economicItemRefs: [refs[0]],
    groups: [{ refs, evidenceRefs: refs }], parents: [] }, 1).data;
  assert.equal(new Set(linked.items.map(item => item.documentGroup)).size, 1);
});

test("prova pode apontar para observação aninhada ou fonte do mesmo grupo local, nunca de outro bloco por nome igual", () => {
  const group = { refs: ["w1:i1", "w2:i1"], evidenceRefs: ["w1:i1:o1", "w2:d1"] };
  const output = materializeWindowAssociation(windows(), { ...plan(), groups: [group] }, 2).data;
  assert.equal(output.items[0].documentGroup, output.items[0].evidenceObservations[0].documentGroup);
  assert.equal(output.items[1].documentGroup, output.documentObservations?.[1].documentGroup);
  const unrelated = windows(); unrelated[1].data.documentObservations![0].documentGroup = "outro";
  assert.throws(() => materializeWindowAssociation(unrelated, { ...plan(), groups: [group] }, 2));
});

test("pais são remapeados por identidade e ciclos ou dupla contagem econômica falham", () => {
  const parent = { childRef: "w2:i1", parentRef: "w1:i1", evidenceRefs: proof("w1:i1", "w2:i1") };
  const output = materializeWindowAssociation(windows(), { ...plan(), parents: [parent] }, 2).data;
  assert.equal(output.items[1].parentLineNumber, 1);
  assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), parents: [parent], economicItemRefs: ["w1:i1", "w2:i1"] }, 2));
  assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), economicItemRefs: [], parents: [parent,
    { ...parent, childRef: "w1:i1", parentRef: "w2:i1" }] }, 2));
  assert.throws(() => materializeWindowAssociation(windows(), { ...plan(), parents: [parent, parent] }, 2));
});

test("prova de hierarquia acima de vinte referências não é truncada pelo contrato", () => {
  const evidenceRefs = Array.from({ length: 25 }, (_, index) => `w1:i${index + 1}`);
  const parsed = windowAssociationPlanSchema.parse({ ...plan(), parents: [{ childRef: "w1:i2",
    parentRef: "w1:i1", evidenceRefs }] });
  assert.equal(parsed.parents[0].evidenceRefs.length, 25);
});

test("plano vazio mantém fontes sem concluir que não existem despesas", () => {
  const result = materializeWindowAssociation(windows(), { ...plan(), economicItemRefs: [] }, 2).data;
  assert.equal(result.items.length, 2);
  assert.equal(result.itemCoverage.extractedItemCount, 0);
  assert.equal(result.itemCoverage.status, "UNKNOWN");
  const prompt = windowConsolidationPrompt(windows(), 2);
  assert.match(prompt, /w1:i1:o1/);
  assert.match(prompt, /w2:d1/);
  assert.match(prompt, /não selecione|Não selecione/);
});

test("correção de associação mantém catálogo completo e trata o plano anterior como dado não confiável", () => {
  const previous = { ...plan(), groups: [{ refs: ["w1:i1", "w2:i1"], evidenceRefs: ["w1:i1", "w1:d1"] }] };
  const prompt = windowConsolidationRepairPrompt(windows(), 2, previous,
    "Association evidence must cover every member.");
  assert.match(prompt, /untrusted_visual_windows/);
  assert.match(prompt, /untrusted_previous_plan/);
  assert.match(prompt, /cada membro de refs precisa ser coberto/i);
  assert.match(prompt, /Association evidence must cover every member/);
  assert.throws(() => windowConsolidationRepairPrompt(windows(), 2, null, "invalid"));
  assert.throws(() => windowConsolidationRepairPrompt(windows(), 2, previous, ""));
});

test("todas as janelas completas preservam cobertura econômica global após seleção", () => {
  const input = windows();
  input.forEach(window => { window.itemCoverageComplete = true; });
  const output = materializeWindowAssociation(input, plan(), 2).data;
  assert.equal(output.itemCoverage.status, "COMPLETE");
  assert.equal(output.itemCoverage.extractedItemCount, 1);
  assert.equal(output.warnings.some(warning => /cobertura global não comprovada/i.test(warning)), false);
  const empty = materializeWindowAssociation(input, { ...plan(), economicItemRefs: [] }, 2).data;
  assert.equal(empty.itemCoverage.status, "UNKNOWN");
});

test("janela apenas de apoio não derruba cobertura econômica e o conjunto global resolve suporte", () => {
  const input = windows();
  input.forEach(window => {
    window.data.documentKind = "REIMBURSEMENT";
    window.data.pageCoverage![0].complete = true;
  });
  input[0].itemCoverageComplete = true;
  input[1].itemCoverageComplete = false;
  input[0].data.warnings = ["Os comprovantes dos itens não estão presentes neste bloco.",
    "Apenas 1 comprovante foi encontrado para 8 despesas listadas na ficha."];
  const output = materializeWindowAssociation(input, plan(), 2).data;
  assert.equal(output.itemCoverage.status, "COMPLETE");
  assert.equal(output.supportCoverage?.status, "COMPLETE");
  assert.deepEqual(output.supportCoverage?.missingDocuments, []);
  assert.match(output.supportCoverage?.evidence ?? "", /1 de 1/);
  assert.equal(output.warnings.some(warning => /não estão presentes neste bloco/i.test(warning)), false);
  assert.equal(output.warnings.some(warning => /apenas 1 comprovante/i.test(warning)), false);
});

test("guarda conta ocorrências idênticas e protege até fontes UNKNOWN", () => {
  const input = windows().slice(0, 1);
  input[0].data.items[0].sourceKind = "UNKNOWN";
  input[0].data.items.push({ ...structuredClone(input[0].data.items[0]), lineNumber: 8 });
  const output = materializeWindowAssociation(input, plan(), 1).data;
  output.items.pop();
  assert.equal(consolidationSourceIssue(input, output), "window-source-dropped-or-rewritten");
});

test("hierarquia local mantém índices remapeados mesmo quando lineNumber não é sequencial", () => {
  const input = windows().slice(0, 1);
  input[0].data.items.push({ ...structuredClone(input[0].data.items[0]), lineNumber: 15,
    parentLineNumber: 7, countsTowardDocumentTotal: false });
  const output = materializeWindowAssociation(input, plan(), 1).data;
  assert.equal(output.items[1].parentLineNumber, 1);
});

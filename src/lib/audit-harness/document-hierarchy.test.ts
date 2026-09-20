import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessInvoice } from "./contracts";
import { completeDocumentBreakdowns, documentHierarchyIssue } from "./document-hierarchy";
import { evaluateUniversalRules } from "./rules";
import { evaluateHarness } from "./engine";
import { hasInsufficientAuditBasis } from "./policy";
import { invoiceExtractionSchema, parseInvoiceExtractionPayload, UNPROVED_BREAKDOWN_WARNING } from "@/lib/integrations/openrouter/extraction-contract";

function composite(total = "507.00", explicitHierarchy = true): HarnessInvoice {
  return {
    documentKind: "COMPOSITE", documentNumber: "synthetic-501", supplierName: "Fornecedor sintético",
    supplierTaxId: null, issuedAt: "2026-07-01", totalAmount: total,
    readConfidence: 0.95, warnings: [], markdown: "Total fiscal e detalhamento do mesmo serviço.",
    itemCoverage: { status: "COMPLETE", declaredItemCount: 1, extractedItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [], evidence: "Uma linha fiscal." },
    items: [
      { lineNumber: 1, description: "Serviço", documentGroup: "nf-sintetica", documentRole: "LINE_ITEM",
        countsTowardDocumentTotal: true, breakdownComplete: explicitHierarchy,
        sourcePage: 1, sourceText: `Serviço ${total}`, quantity: "1", unitPrice: total, totalAmount: total,
        evidenceObservations: [{ kind: "RECEIPT", label: "Nota fiscal", amount: total, date: "2026-07-01", page: 1, text: `Serviço ${total}` }] },
      ...["500.00", "7.00"].map((amount, index) => ({
        lineNumber: index + 2, description: `Componente ${index + 1}`, documentGroup: "nf-sintetica",
        documentRole: "LINE_ITEM" as const, countsTowardDocumentTotal: false,
        parentLineNumber: explicitHierarchy ? 1 : null, sourcePage: 2, sourceText: `Componente ${index + 1}: ${amount}`,
        quantity: "1", unitPrice: amount, totalAmount: amount,
        evidenceObservations: [{ kind: "SHEET" as const, label: "Controle", amount, date: null,
          page: 2, text: `Componente ${index + 1}: ${amount}` }],
      })),
    ],
  };
}

test("total fiscal mais componentes não são valores alternativos da mesma transação", () => {
  for (const explicit of [true, false]) {
    const { findings } = evaluateUniversalRules({ invoice: composite("507.00", explicit) });
    assert.equal(findings.some((finding) => finding.category === "AMOUNTS"), false);
  }
});

test("documentos conciliados podem terminar OK em diferentes valores, sem obrigação de produzir achados", () => {
  // Synthetic ranges, not supplier/file-specific exceptions or a real-note oracle.
  for (let seed = 1; seed <= 40; seed++) {
    const parts = [seed * 137 + 23, seed * 19 + 7];
    const money = (cents: number) => (cents / 100).toFixed(2);
    const total = money(parts[0] + parts[1]);
    const invoice = composite(total);
    invoice.supportCoverage = { status: "COMPLETE", referencedDocuments: ["Detalhamento"], presentDocuments: ["Detalhamento"],
      missingDocuments: [], basis: "DOCUMENT_REFERENCES", evidence: "Detalhamento completo do serviço anexado." };
    invoice.items.slice(1).forEach((item, index) => {
      item.totalAmount = money(parts[index]); item.unitPrice = item.totalAmount;
      item.sourceText = `Componente ${index + 1}: ${item.totalAmount}`;
      item.evidenceObservations![0].amount = item.totalAmount;
      item.evidenceObservations![0].text = item.sourceText;
    });
    const result = evaluateHarness({ invoice, now: new Date("2026-09-08T12:00:00Z") });
    assert.equal(result.classification, "OK", `seed ${seed}`);
    assert.equal(result.findings.length, 0, `seed ${seed}`);
    // A self-contained composite without an aggregate payment or external
    // references does not invent a missing support-document requirement.
    invoice.supportCoverage.status = "UNKNOWN";
    const limited = evaluateHarness({ invoice, now: new Date("2026-09-08T12:00:00Z") });
    assert.equal(limited.classification, "OK", `seed ${seed}`);
    assert.equal(limited.findings.length, 0, `seed ${seed}`);
  }
});

test("grupo amplo não prova que dois controles são a mesma transação", () => {
  const { findings } = evaluateUniversalRules({ invoice: composite("600.00", false) });
  assert.equal(findings.some((finding) => finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH")), false);
  assert.equal(hasInsufficientAuditBasis(composite("600.00", false)), true);
});

test("detalhamento completo e explicitamente vinculado expõe diferença real", () => {
  const { findings } = evaluateUniversalRules({ invoice: composite("509.00") });
  const mismatches = findings.filter((finding) => finding.category === "AMOUNTS");
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].code, "DOCUMENT_BREAKDOWN_MISMATCH_1");
  assert.deepEqual(mismatches[0].actualValue, ["509.00", "507.00"]);
});

test("inventário da página impede divergência baseada em detalhamento truncado", () => {
  const invoice = composite("509.00");
  for (const item of invoice.items) {
    item.sourceKind = "SHEET";
    item.sourcePage = 2;
  }
  invoice.pageCoverage = [{
    page: 2,
    complete: true,
    fieldsReviewed: true,
    requirementScope: "NONE",
    requirementEvidence: null,
    sources: [{ kind: "SHEET", count: 35 }],
  }];
  assert.equal(evaluateUniversalRules({ invoice }).findings.some((finding) =>
    finding.code === "DOCUMENT_BREAKDOWN_MISMATCH_1"), false);

  invoice.pageCoverage[0].sources[0].count = 3;
  assert.equal(evaluateUniversalRules({ invoice }).findings.some((finding) =>
    finding.code === "DOCUMENT_BREAKDOWN_MISMATCH_1"), true);
});

test("desconto explícito e rastreável reconcilia o total líquido do detalhamento", () => {
  const invoice = composite("502.40");
  invoice.items[0].evidenceObservations!.push({ kind: "DISCOUNT", amountScope: "ADJUSTMENT",
    documentGroup: "nf-sintetica", label: "Desconto", amount: "4.60", date: null, page: 1,
    text: "Soma 507,00 Desconto 4,60 Total Geral 502,40" });
  const breakdown = completeDocumentBreakdowns(invoice.items)[0];
  assert.equal(breakdown.discounts.length, 1);
  assert.equal(evaluateUniversalRules({ invoice }).findings.some(finding =>
    finding.code === "DOCUMENT_BREAKDOWN_MISMATCH_1"), false);
});

test("desconto não rastreável ou de outro grupo não encobre divergência", () => {
  for (const variant of ["quote", "group"] as const) {
    const invoice = composite("502.40");
    invoice.items[0].evidenceObservations!.push({ kind: "DISCOUNT", amountScope: "ADJUSTMENT",
      documentGroup: variant === "group" ? "outra-despesa" : "nf-sintetica", label: "Desconto",
      amount: "4.60", date: null, page: 1, text: variant === "quote" ? "Desconto não legível" : "Desconto 4,60" });
    assert.ok(evaluateUniversalRules({ invoice }).findings.some(finding =>
      finding.code === "DOCUMENT_BREAKDOWN_MISMATCH_1"), variant);
  }
});

test("linha explícita de desconto não é somada como componente do produto pai", () => {
  const invoice = composite("15.00");
  invoice.items = [invoice.items[0], {
    lineNumber: 2, description: "DESCONTO", documentGroup: "nf-sintetica", documentRole: "LINE_ITEM",
    countsTowardDocumentTotal: false, parentLineNumber: 1, breakdownComplete: false,
    sourceKind: "SHEET", sourcePage: 1, sourceText: "TOTAL VENDA 15,00 DESCONTOS 3,00 TOTAL GERAL 12,00",
    quantity: null, unitPrice: null, totalAmount: "3.00", evidenceObservations: [{ kind: "SHEET",
      amountScope: "ITEM_TOTAL", documentGroup: "nf-sintetica", label: null, amount: "3.00",
      date: null, page: 1, text: "DESCONTOS 3,00" }],
  }];
  assert.deepEqual(completeDocumentBreakdowns(invoice.items), []);
  assert.equal(evaluateUniversalRules({ invoice }).findings.some(finding =>
    finding.code === "DOCUMENT_BREAKDOWN_MISMATCH_1"), false);
});

test("detalhamento parcial não prova diferença contra o total", () => {
  const invoice = composite("509.00");
  invoice.items[0].breakdownComplete = false;
  assert.equal(evaluateUniversalRules({ invoice }).findings.some((finding) => finding.category === "AMOUNTS"), false);
});

test("conciliação de hierarquia não apaga conflito dentro de uma linha", () => {
  const invoice = composite();
  invoice.items[1].evidenceObservations!.push({ kind: "RECEIPT", label: "Recibo do componente", amount: "510.00", date: null, page: 3, text: "Componente 1: 510,00" });
  const { findings } = evaluateUniversalRules({ invoice });
  assert.ok(findings.some((finding) => finding.code === "EVIDENCE_AMOUNT_MISMATCH_2"));
});

test("subtotal e detalhamento diário não são contados duas vezes", () => {
  const invoice = composite();
  invoice.items[1].breakdownComplete = true;
  invoice.items.push(...["300.00", "200.00"].map((amount, index) => ({
    lineNumber: index + 4, parentLineNumber: 2, countsTowardDocumentTotal: false,
    description: `Dia ${index + 1}`, quantity: "1", unitPrice: amount, totalAmount: amount,
  })));
  assert.equal(documentHierarchyIssue(invoice.items), null);
  assert.deepEqual(completeDocumentBreakdowns(invoice.items).map(({ children }) => children.map((item) => item.lineNumber)), [[2, 3], [4, 5]]);
  assert.equal(evaluateUniversalRules({ invoice }).findings.some((finding) => finding.category === "AMOUNTS"), false);
});

function flatSchedule() {
  const invoice = composite();
  invoice.items[1].documentRole = "SUMMARY";
  invoice.items[2].documentRole = "SUMMARY";
  for (const row of invoice.items.slice(1)) {
    row.sourceKind = "SHEET"; row.arithmeticVerified = true; row.unit = "UN";
  }
  invoice.items[1].quantity = "20"; invoice.items[1].unitPrice = "25.00";
  invoice.items.push(...[8, 12].map((quantity, index) => ({
    lineNumber: index + 4, description: `Controle diário ${index + 1}`, documentGroup: "nf-sintetica",
    documentRole: "SUPPORTING_DOCUMENT" as const, sourceKind: "SHEET" as const,
    parentLineNumber: 1, countsTowardDocumentTotal: false, arithmeticVerified: true,
    unit: "UN", quantity: String(quantity), unitPrice: "25.00", totalAmount: (quantity * 25).toFixed(2),
    sourcePage: 2, sourceText: `Dia ${index + 1}: ${quantity} unidades total ${(quantity * 25).toFixed(2)}`,
  })));
  return invoice;
}

test("extração achatada concilia visões por quantidade, preço e fonte, sem somar o consumo duas vezes", () => {
  const invoice = flatSchedule(), before = structuredClone(invoice);
  assert.equal(documentHierarchyIssue(invoice.items), null);
  assert.deepEqual(completeDocumentBreakdowns(invoice.items)[0].children.map(i => i.lineNumber), [2, 3]);
  assert.equal(evaluateUniversalRules({invoice}).findings.some(f => f.code.startsWith("DOCUMENT_BREAKDOWN_MISMATCH")), false);
  assert.deepEqual(invoice, before);
  invoice.items[0].totalAmount = "509.00";
  assert.ok(evaluateUniversalRules({invoice}).findings.some(f => f.code === "DOCUMENT_BREAKDOWN_MISMATCH_1"));
});

test("igualdade de soma sozinha não resolve camadas sobrepostas", () => {
  for (const scenario of ["page", "group", "price", "quantity", "unverified", "quote", "ambiguous-price"]) {
    const invoice = flatSchedule();
    const row = invoice.items[3];
    if (scenario === "page") row.sourcePage = 3;
    if (scenario === "group") row.documentGroup = "outro";
    if (scenario === "price") row.unitPrice = "20.00";
    if (scenario === "quantity") row.quantity = "7";
    if (scenario === "unverified") row.arithmeticVerified = false;
    if (scenario === "quote") row.sourceText = "sem valor visível";
    if (scenario === "ambiguous-price") invoice.items.push({...invoice.items[1],lineNumber:99});
    assert.notEqual(documentHierarchyIssue(invoice.items), null, scenario);
    assert.equal(completeDocumentBreakdowns(invoice.items).length, 0, scenario);
  }
});

test("hierarquia rejeita ciclos, pais ausentes e camadas econômicas sobrepostas", () => {
  for (const variant of ["cycle", "missing", "overlap"]) {
    const invoice = composite();
    if (variant === "cycle") invoice.items[0].parentLineNumber = 2;
    if (variant === "missing") invoice.items[1].parentLineNumber = 99;
    if (variant === "overlap") invoice.items[1].countsTowardDocumentTotal = true;
    assert.notEqual(documentHierarchyIssue(invoice.items), null);
    assert.equal(completeDocumentBreakdowns(invoice.items).length, 0);
  }
});

test("parser preserva relações ao normalizar numeração e rejeita identidade ambígua", () => {
  const original = composite();
  original.items[0].lineNumber = 10;
  original.items[1].parentLineNumber = 10;
  original.items[2].parentLineNumber = 10;
  const parsed = parseInvoiceExtractionPayload({ ...original, currency: "BRL", unknownExtra: "force safe normalization" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.items[0].lineNumber, 1);
    assert.equal(parsed.data.items[1].parentLineNumber, 1);
  }
  original.items[1].lineNumber = 10;
  assert.equal(parseInvoiceExtractionPayload(original).success, false);
});

test("escopos monetários distintos não viram alternativas de um mesmo valor", () => {
  const invoice = composite();
  invoice.items[1].evidenceObservations = [
    { kind: "SHEET", amountScope: "ITEM_TOTAL", amount: "500.00", date: null, page: 2, label: "Linha", text: "Total da linha 500" },
    { kind: "RECEIPT", amountScope: "DOCUMENT_TOTAL", amount: "507.00", date: null, page: 1, label: "Total", text: "Total geral 507" },
    { kind: "OTHER", amountScope: "UNIT_VALUE", amount: "25.00", date: null, page: 2, label: "Unitário", text: "25 por unidade" },
  ];
  assert.equal(evaluateUniversalRules({ invoice }).findings.some((finding) => finding.category === "AMOUNTS"), false);
  invoice.items[1].evidenceObservations.push({ kind: "RECEIPT", amountScope: "ITEM_TOTAL", amount: "510.00", date: null, page: 3, label: "Recibo da linha", text: "Total da linha 510" });
  assert.ok(evaluateUniversalRules({ invoice }).findings.some((finding) => finding.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_2")));
});

test("pai inexistente não é reinterpretado como uma nova linha canônica", () => {
  const invoice = composite();
  invoice.items.forEach((item, index) => { item.lineNumber = 10 * (index + 1); });
  invoice.items[1].parentLineNumber = 1;
  invoice.items[2].parentLineNumber = 10;
  assert.equal(parseInvoiceExtractionPayload({ ...invoice, currency: "BRL" }).success, false);
});

test("uma relação válida não encobre outra linha sem vínculo no mesmo grupo", () => {
  const invoice = composite();
  invoice.items[2].parentLineNumber = null;
  assert.equal(hasInsufficientAuditBasis(invoice), true);
});

test("declaração impossível numa folha não descarta valores, relações ou trechos recuperáveis", () => {
  const invoice = { ...composite(), currency: "BRL" };
  invoice.items[1].breakdownComplete = true;
  invoice.items[2].breakdownComplete = true;
  const original = structuredClone(invoice);
  assert.equal(invoiceExtractionSchema.safeParse(invoice).success, false);
  const recovered = parseInvoiceExtractionPayload(invoice);
  assert.ok(recovered.success);
  assert.equal(recovered.data.items.length, 3);
  assert.equal(recovered.data.items[0].breakdownComplete, true);
  assert.deepEqual(recovered.data.items.slice(1).map((item) => item.breakdownComplete), [false, false]);
  assert.deepEqual(recovered.data.items.map((item) => item.parentLineNumber), [undefined, 1, 1]);
  assert.deepEqual(recovered.data.items.map((item) => [item.quantity, item.unitPrice, item.totalAmount, item.sourceText]),
    original.items.map((item) => [item.quantity, item.unitPrice, item.totalAmount, item.sourceText]));
  assert.ok(recovered.data.warnings.includes(UNPROVED_BREAKDOWN_WARNING));
  assert.equal(hasInsufficientAuditBasis(recovered.data), true);
  assert.deepEqual(invoice, original);
  const secondParse = parseInvoiceExtractionPayload(recovered.data);
  assert.ok(secondParse.success);
  assert.equal(secondParse.data.warnings.filter((warning) => warning === UNPROVED_BREAKDOWN_WARNING).length, 1);
});

test("revogar completude de folha nunca inventa filhos nem repara ciclos, pais ausentes ou dupla contagem", () => {
  const invoice = { ...composite(), currency: "BRL" };
  invoice.items[1].breakdownComplete = true;
  for (const variant of ["cycle", "missing", "overlap"]) {
    const invalid = structuredClone(invoice);
    if (variant === "cycle") invalid.items[0].parentLineNumber = 2;
    if (variant === "missing") invalid.items[1].parentLineNumber = 99;
    if (variant === "overlap") invalid.items[1].countsTowardDocumentTotal = true;
    assert.equal(parseInvoiceExtractionPayload(invalid).success, false, variant);
  }
});

test("fragmento de janela pode adiar a escolha da camada econômica sem enfraquecer o documento final", () => {
  const fragment = { ...composite(), currency: "BRL" };
  fragment.items[1].countsTowardDocumentTotal = true;
  fragment.itemCoverage = { status: "COMPLETE", declaredItemCount: 2, extractedItemCount: 2,
    firstLineNumber: 1, lastLineNumber: 2, missingLineNumbers: [], evidence: "Leitura local da janela." };

  assert.equal(parseInvoiceExtractionPayload(fragment).success, false);

  const recovered = parseInvoiceExtractionPayload(fragment, { windowFragment: true });
  assert.equal(recovered.success, true);
  if (!recovered.success) return;
  assert.deepEqual(recovered.data.items.map(item => item.countsTowardDocumentTotal), [true, false, false]);
  assert.deepEqual(recovered.data.itemCoverage, {
    status: "COMPLETE",
    declaredItemCount: null,
    extractedItemCount: 1,
    firstLineNumber: 1,
    lastLineNumber: 1,
    missingLineNumbers: [],
    evidence: "Leitura local da janela.",
  });

  const invalidFinal = structuredClone(fragment);
  assert.equal(parseInvoiceExtractionPayload(invalidFinal).success, false);
});

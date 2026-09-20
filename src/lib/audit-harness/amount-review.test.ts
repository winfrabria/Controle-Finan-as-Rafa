import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessInvoice } from "./contracts";
import { buildAmountReviewSources, hasAmountReviewEvidence, isMonetaryEvidence } from "./amount-review";
import { buildVerificationChecks, validateVerificationCoverage, type VerificationResponse } from "./verification";

function invoice(): HarnessInvoice {
  return { documentKind: "COMPOSITE", documentNumber: null, issuedAt: null, supplierName: null,
    supplierTaxId: null, totalAmount: "76.00", readConfidence: 0.9, warnings: [], markdown: "Documento sintético",
    items: [{ lineNumber: 7, description: "Despesa sintética", quantity: null, unitPrice: null,
      totalAmount: "76.00", sourceKind: "SHEET", sourcePage: 2, evidenceObservations: [
        { kind: "SHEET", page: 2, amount: "76.00", date: null, label: null, text: "Ficha 76,00" },
        { kind: "RECEIPT", page: 5, amount: "76.00", date: null, label: null, text: "Recibo 76,00" },
        { kind: "PAYMENT", page: 5, amount: "86.00", date: null, label: null, text: "Débito 86,00" },
      ] }] };
}

test("conferência de valor preserva fontes distintas na mesma página sem duplicar os checks", () => {
  const input = invoice();
  const sources = [{ kind: "SHEET", page: 2 }, { kind: "RECEIPT", page: 5 }, { kind: "PAYMENT", page: 5 }];
  assert.deepEqual(buildAmountReviewSources(input), [{ lineNumber: 7, sources }]);
  const checks = buildVerificationChecks(input);
  assert.equal(checks.length, 5);
  assert.equal(checks.filter(check => check.amountPair).length, 3);
  assert.deepEqual(checks.find(check => check.key === "line:7")?.amountReview, { sources });
  assert.equal(JSON.stringify(checks).includes("76.00"), false, "No expected amount should bias the rereading.");
});

test("valor zero é conhecido; fonte sem valor ou página válida não fabrica obrigação localizada", () => {
  const input = invoice();
  input.items[0].sourcePage = null;
  input.items[0].evidenceObservations = [
    { kind: "DISCOUNT", page: 3, amount: "0.00", date: null, label: null, text: "Desconto R$ 0,00" },
    { kind: "PAYMENT", page: 4, amount: null, date: null, label: null, text: "Pagamento" },
    { kind: "RECEIPT", page: -1, amount: "20.00", date: null, label: null, text: "Recibo" },
    { kind: "SALE", page: 4, amount: "invalid", date: null, label: null, text: "Venda" },
  ];
  assert.deepEqual(buildAmountReviewSources(input), [{ lineNumber: 7, sources: [{ kind: "DISCOUNT", page: 3 }] }]);
});

test("atenção monetária não cria vínculo por valor igual entre despesas", () => {
  const input = invoice();
  input.items[0].documentGroup = "a";
  input.items.push({ ...input.items[0], lineNumber: 8, documentGroup: "b", sourcePage: 9, evidenceObservations: [] });
  assert.deepEqual(buildAmountReviewSources(input)[1], { lineNumber: 8, sources: [{ kind: "SHEET", page: 9 }] });
  assert.equal(buildVerificationChecks(input).some(check => check.sourcePair), false);
});

test("evidência monetária aceita formatos e zero, mas não data, horário, quantidade ou identificador", () => {
  for (const { field, quote } of [
    { field: "valor", quote: "Total R$ 0,00" },
    { field: "valor", quote: "Total 1.254,00" },
    { field: "valor", quote: "Amount 98.70" },
    { field: "desconto", quote: "DESC 1,20" },
    { field: "discountAmount", quote: "Discount 12.00" },
    { field: "valor", quote: "Total R$ 76" },
    { field: "valor", quote: "Total USD 76" },
  ]) {
    assert.equal(isMonetaryEvidence({ field, quote }), true, `${field}: ${quote}`);
  }
  assert.equal(isMonetaryEvidence({ field: "data e valor", quote: "14/06/26 R$ 76,00" }), true);
  for (const quote of ["14/06/2026", "14.06.26", "DATA: 14,06,26", "14:28:10", "Quantidade 76", "NFC-e 76543", "abc76.00xyz", "Código 76.00.4"]) {
    assert.equal(isMonetaryEvidence({ field: "valor", quote }), false, quote);
  }
  assert.equal(isMonetaryEvidence({ field: "data", quote: "14/06/26 R$ 76,00" }), false);
});

test("precisão fiscal estendida exige rótulo monetário sem arredondar ou confundir quantidade", () => {
  for (const quote of ["Valor Pago 76,000", "Total Geral: 1.276,125", "VALOR LÍQUIDO 0,0000", "R$ 76,1234", "BRL 76,000"])
    assert.equal(isMonetaryEvidence({ field: "data e valor", quote }), true, quote);
  for (const quote of ["Quantidade 76,000", "Litros 76,000", "ICMS 12,000%", "Código 76,000", "Valor Pago: quantidade 76,000", "Valor Pago 76,00001", "Valor Pago 76.000"])
    assert.equal(isMonetaryEvidence({ field: "valor", quote }), false, quote);
  assert.equal(isMonetaryEvidence({ field: "quantidade", quote: "Valor Pago 76,000" }), false);
  assert.equal(hasAmountReviewEvidence([{ kind: "RECEIPT", page: 6 }], [
    { source: "RECEIPT", page: 6, field: "valor", quote: "Valor Pago 76,000" },
  ]), true);
});

test("data de todas as páginas não confere valores nem permite substituir recibo por pagamento", () => {
  // Isolate the source-reading contract; pair dispositions have their own tests.
  const expected = buildVerificationChecks(invoice()).filter(check => !check.key.startsWith("amount-pair:"))
    .map(({ amountPair: _pair, ...check }) => { void _pair; return check; });
  const response: VerificationResponse = { status: "PASS", summary: "Sintético", findings: [], limitations: [],
    pageCoverage: { status: "COMPLETE", expectedPageCount: 5, checkedPages: [1, 2, 3, 4, 5], missingPages: [] },
    checks: expected.map(({ key, lineNumber, documentRole, documentGroup }) => ({
      key, lineNumber, documentRole: documentRole ?? null, documentGroup, state: "VERIFIED", findingCode: null,
      limitationCode: null, comparison: null,
      evidence: [1, 2, 3, 4, 5].map(page => ({ page, source: "SHEET", field: "data", quote: "14/06/2026" })),
    })) };
  const coverage = () => validateVerificationCoverage({ expectedChecks: expected, expectedPageCount: 5, response });
  assert.deepEqual(coverage().invalidEvidenceCheckKeys, ["line:7"]);
  const check = response.checks.find(check => check.key === "line:7")!;
  check.evidence = [
    { page: 2, source: "SHEET", field: "valor", quote: "Total 76,00" },
    { page: 5, source: "RECEIPT", field: "valor", quote: "Total 76,00" },
  ];
  assert.equal(coverage().complete, false, "The payment on the same page is still missing.");
  check.evidence.push({ page: 5, source: "PAYMENT", field: "valor", quote: "Total 86,00" });
  assert.equal(coverage().complete, true, "Trace coverage is not proof of semantic reconciliation.");
  check.evidence[2].page = 4;
  assert.equal(coverage().complete, false);
  check.state = "LIMITATION"; check.limitationCode = "AMOUNT_UNREADABLE"; check.evidence = [];
  assert.deepEqual(coverage().invalidEvidenceCheckKeys, []);
  assert.equal(coverage().complete, false);
});

test("conferência não exige repetir o valor extraído e não fabrica conflito total/componentes", () => {
  const sources = [{ kind: "SHEET" as const, page: 2 }, { kind: "RECEIPT" as const, page: 5 }];
  assert.equal(hasAmountReviewEvidence(sources, [
    { page: 2, source: "SHEET", field: "valor", quote: "Almoço 240,00 e água 6,00; total 246,00" },
    { page: 5, source: "RECEIPT", field: "valor", quote: "Total 246,00" },
  ]), true);
  assert.equal(hasAmountReviewEvidence(sources, [
    { page: 2, source: "PAYMENT", field: "valor", quote: "Total 246,00" },
    { page: 5, source: "RECEIPT", field: "valor", quote: "Total 246,00" },
  ]), false);
});

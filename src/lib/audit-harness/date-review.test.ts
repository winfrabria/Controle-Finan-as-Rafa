import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessInvoice } from "./contracts";
import { buildDateReviewSources, datedEvidenceClaims, isDatedEvidence } from "./date-review";
import { buildVerificationChecks, validateVerificationCoverage, type VerificationResponse } from "./verification";

function invoice(): HarnessInvoice {
  return { documentKind: "REIMBURSEMENT", documentNumber: null, issuedAt: null,
    supplierName: null, supplierTaxId: null, totalAmount: "72.00", readConfidence: 0.9,
    warnings: [], markdown: "Ficha e comprovante sintéticos", items: [{
      lineNumber: 1, description: "Despesa sintética", quantity: null, unitPrice: null,
      totalAmount: "72.00", sourceKind: "SHEET", sourceDate: "2026-04-12", sourcePage: 1,
      sourceText: "Data 12/04/2026; R$ 72,00",
      evidenceObservations: [{ kind: "RECEIPT", amount: "72.00", date: "2026-04-11", page: 2,
        label: null, text: "Data 11/04/2026; R$ 72,00" }],
    }] };
}

test("datas divergentes ganham conferência própria mesmo quando os valores coincidem", () => {
  const input = invoice();
  assert.deepEqual(buildDateReviewSources(input), [{ lineNumber: 1, pages: [1, 2] }]);
  const checks = buildVerificationChecks(input);
  assert.equal(checks.filter(check => check.key === "line:1").length, 1);
  assert.deepEqual(checks.find(check => check.key === "line:1")?.fieldReview, { field: "DATE", pages: [1, 2] });
  assert.equal(checks.length, 3, "Date and first monetary comparison share the row check inventory.");
  assert.equal(checks.filter(check => check.amountPair).length, 1);
});

test("atenção a datas não cria vínculo ou achado entre grupos distintos", () => {
  const input = invoice();
  input.items[0].documentGroup = "grupo-a";
  input.items.push({ ...input.items[0], lineNumber: 2, documentGroup: "grupo-b", sourcePage: 3, evidenceObservations: [] });
  assert.equal(buildDateReviewSources(input).length, 1);
  assert.equal(buildVerificationChecks(input).some(check => check.sourcePair), false);
});

test("datas sem localização não fabricam páginas e páginas repetidas são únicas", () => {
  const input = invoice();
  input.items[0].sourcePage = -1;
  input.items[0].evidenceObservations!.push({ ...input.items[0].evidenceObservations![0] });
  assert.deepEqual(buildDateReviewSources(input), []);
  input.items[0].evidenceObservations = [];
  assert.deepEqual(buildDateReviewSources(input), []);
});

test("data copiada de outro cabeçalho não pede conferência sem trecho na própria fonte", () => {
  const input = invoice();
  input.items[0].sourceText = "Valor do serviço R$ 72,00";
  assert.deepEqual(buildDateReviewSources(input), []);
  input.items[0].evidenceObservations![0].text = "Recibo R$ 72,00";
  assert.deepEqual(buildDateReviewSources(input), []);
});

test("datas rastreáveis e iguais não ampliam a verificação seletiva", () => {
  const input = invoice();
  input.items[0].evidenceObservations![0].date = "2026-04-12";
  input.items[0].evidenceObservations![0].text = "Data 12/04/2026; R$ 72,00";
  assert.deepEqual(buildDateReviewSources(input), []);
  assert.equal(buildVerificationChecks(input).find(check => check.key === "line:1")?.fieldReview, undefined);
});

test("evidência de data exige a dimensão correta e uma data de calendário localizável", () => {
  assert.equal(isDatedEvidence({ field: "Data do recibo", quote: "Emissão 11/04/2026" }), true);
  assert.equal(isDatedEvidence({ field: "sourceDate", quote: "Data 2026-04-11" }), true);
  assert.equal(isDatedEvidence({ field: "data", quote: "Data 11/04/26" }), true);
  for (const quote of ["TOTAL R$ 72,00", "Data 31/02/2026", "Data 29/02/2025", "IDabc2026-04-11def", "Data 32/04/26"]) {
    assert.equal(isDatedEvidence({ field: "data", quote }), false, quote);
  }
  assert.equal(isDatedEvidence({ field: "valor", quote: "11/04/2026 R$ 72,00" }), false);
});

test("cobertura rejeita conferir data citando apenas valor ou omitindo uma das páginas", () => {
  // Isolate date/source tracing; monetary pair dispositions are tested separately.
  const expected = buildVerificationChecks(invoice()).map(({ amountPair: _pair, ...check }) => { void _pair; return check; });
  const value: VerificationResponse = { status: "PASS", summary: "Conferência sintética", findings: [], limitations: [],
    pageCoverage: { status: "COMPLETE", expectedPageCount: 2, checkedPages: [1, 2], missingPages: [] },
    checks: expected.map(({ key, lineNumber, documentRole, documentGroup }) => ({
      key, lineNumber, documentRole: documentRole ?? null, documentGroup, state: "VERIFIED", findingCode: null, limitationCode: null,
      comparison: null, evidence: [1, 2].map(page => ({ page, source: "Original", field: "valor", quote: "Total R$ 72,00" })),
    })),
  };
  const coverage = () => validateVerificationCoverage({ expectedChecks: expected, expectedPageCount: 2, response: value });
  assert.deepEqual(coverage().invalidEvidenceCheckKeys, ["line:1"]);
  const check = value.checks.find(check => check.key === "line:1")!;
  check.evidence = [{ page: 1, source: "SHEET", field: "data e valor", quote: "Data 12/04/2026; total R$ 72,00" }];
  assert.equal(coverage().complete, false);
  check.evidence.push({ page: 2, source: "RECEIPT", field: "data e valor", quote: "Data 11/04/2026; total R$ 72,00" });
  // Trace completeness is not semantic agreement: it only proves both date
  // excerpts were supplied. The model's conclusion still needs corpus review.
  assert.equal(coverage().complete, true);
  check.state = "LIMITATION"; check.limitationCode = "DATE_UNREADABLE"; check.evidence = [];
  assert.deepEqual(coverage().invalidEvidenceCheckKeys, []);
  assert.equal(coverage().complete, false);
});

test("data manuscrita com vírgulas exige rótulo explícito e calendário válido", () => {
  for (const quote of ["DATA: 08,05,26 TOTAL 50,00", "Data 9, 4, 2026", "Emissão: 29,02,2024"]) {
    assert.equal(isDatedEvidence({ field: "data", quote }), true, quote);
  }
  for (const quote of ["08,05,26", "Valores 08,05,26", "Data 31,04,26", "Data 29,02,2025", "Data 08,05,26abc", "Data 08,05,26,77"]) {
    assert.equal(isDatedEvidence({ field: "data", quote }), false, quote);
  }
  assert.equal(isDatedEvidence({ field: "valor", quote: "DATA: 08,05,26" }), false);
});

test("datas por extenso preservam calendário, dimensão e ano explícito", () => {
  for (const quote of ["18 de maio de 2026 RECIBO R$ 30,00", "Emissão 1 DE MARÇO DE 2024", "Data 29 de fevereiro de 2024"]) {
    assert.equal(isDatedEvidence({ field: "DATE", quote }), true, quote);
  }
  for (const quote of ["31 de abril de 2026", "29 de fevereiro de 2025", "18 de maio", "18 de maio de 26",
    "abc18 de maio de 2026", "18 de maio de 2026xyz", "0 de maio de 2026", "18 de mai de 2026"]) {
    assert.equal(isDatedEvidence({ field: "DATE", quote }), false, quote);
  }
  assert.equal(isDatedEvidence({ field: "TOTAL", quote: "18 de maio de 2026" }), false);
});

test("normaliza apenas datas explícitas e válidas para comparação semântica", () => {
  assert.deepEqual(datedEvidenceClaims({ field: "data", quote: "Emissão 19/05/2026" }), ["2026-05-19"]);
  assert.deepEqual(datedEvidenceClaims({ field: "DATE", quote: "Data 18/05/26" }), ["26-05-18"]);
  assert.deepEqual(datedEvidenceClaims({ field: "data", quote: "18 de maio de 2026" }), ["2026-05-18"]);
  assert.deepEqual(datedEvidenceClaims({ field: "valor", quote: "Data 19/05/2026; R$ 10,00" }), []);
  assert.deepEqual(datedEvidenceClaims({ field: "data", quote: "31/02/2026" }), []);
});

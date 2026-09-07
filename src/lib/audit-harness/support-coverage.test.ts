import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHarness } from "./engine";
import { evaluateUniversalRules } from "./rules";
import type { HarnessInvoice } from "./contracts";
import { selectVerification } from "./verification";

function completeCoverage(lineNumber: number) {
  return {
    status: "COMPLETE" as const,
    declaredItemCount: 1,
    extractedItemCount: 1,
    firstLineNumber: lineNumber,
    lastLineNumber: lineNumber,
    missingLineNumbers: [],
    evidence: "Camada econômica integral confirmada.",
  };
}

function aggregateInvoice(): HarnessInvoice {
  return {
    documentKind: "COMPOSITE",
    documentNumber: null,
    supplierName: null,
    supplierTaxId: null,
    issuedAt: null,
    totalAmount: "20.00",
    readConfidence: 0.99,
    warnings: [],
    markdown: "Boleto agregado cita dois documentos; um está presente.",
    itemCoverage: completeCoverage(2),
    supportCoverage: {
      status: "PARTIAL",
      referencedDocuments: ["Documento A", "Documento B"],
      presentDocuments: ["Documento A"],
      missingDocuments: ["Documento B"],
      basis: "DOCUMENT_REFERENCES",
      evidence: "Relação de documentos impressa no boleto.",
    },
    items: [
      {
        lineNumber: 1,
        description: "Cobrança agregada",
        documentGroup: "grupo-1",
        documentRole: "AGGREGATE_PAYMENT",
        countsTowardDocumentTotal: false,
        quantity: null,
        unitPrice: null,
        totalAmount: "100.00",
      },
      {
        lineNumber: 2,
        description: "Documento de suporte presente",
        documentGroup: "grupo-1",
        documentRole: "SUPPORTING_DOCUMENT",
        countsTowardDocumentTotal: true,
        quantity: "1",
        unitPrice: "20.00",
        totalAmount: "20.00",
      },
    ],
  };
}

test("cobertura parcial pergunta antes de suspeitar e não inventa gap", () => {
  const invoice = aggregateInvoice();
  const result = evaluateHarness({ invoice });
  assert.equal(result.classification, "NEEDS_CONTEXT");
  assert.equal(result.contextQuestions.length, 1);
  assert.equal(
    result.contextQuestions[0].prompt,
    "Este arquivo contém todo o conjunto cobrado neste boleto?",
  );
  assert.equal(
    result.findings.some((finding) =>
      finding.code.startsWith("COMPOSITE_PAYMENT_DOCUMENT_GAP"),
    ),
    false,
  );
});

for (const status of ["UNKNOWN", "PARTIAL", "ABSENT"] as const) {
  test(`cobertura ${status} sem lista de ausentes não permite OK`, () => {
    const invoice = aggregateInvoice();
    invoice.supportCoverage = status === "ABSENT" ? undefined : {
      status, referencedDocuments: [], presentDocuments: ["Documento A"],
      missingDocuments: [], basis: "NONE", evidence: null,
    };
    const result = evaluateHarness({ invoice });
    assert.equal(result.classification, "INFORMATION_INSUFFICIENT");
    assert.equal(result.findings.length, 0);
    assert.equal(result.contextQuestions.length, 0);
    const selection = selectVerification({
      invoice, aiCoverage: true, baseClassification: result.classification,
      baseFindings: result.findings, pageCount: 8,
    });
    assert.equal(selection.required, true);
    assert.ok(selection.reasons.includes("SUPPORT_COVERAGE_NOT_COMPLETE"));
  });
}

test("cobertura comprovadamente completa e valores conciliados permitem OK", () => {
  const invoice = aggregateInvoice();
  invoice.items[0].totalAmount = "20.00";
  invoice.supportCoverage = {
    status: "COMPLETE", referencedDocuments: ["Documento A"],
    presentDocuments: ["Documento A"], missingDocuments: [],
    basis: "DOCUMENT_REFERENCES", evidence: "Todos os documentos citados estão presentes.",
  };
  assert.equal(evaluateHarness({ invoice }).classification, "OK");
});

test("nota simples não exige comprovantes que não fazem parte do documento", () => {
  const invoice = aggregateInvoice();
  invoice.documentKind = "FISCAL_INVOICE";
  invoice.items = [{ ...invoice.items[1], documentRole: "LINE_ITEM" }];
  invoice.supportCoverage = { status: "UNKNOWN", referencedDocuments: [],
    presentDocuments: [], missingDocuments: [], basis: "NONE", evidence: null };
  assert.equal(evaluateHarness({ invoice }).classification, "OK");
});

test("cobertura incerta não remove divergência independente comprovada", () => {
  const invoice = aggregateInvoice();
  invoice.supportCoverage = undefined;
  invoice.totalAmount = "30.00";
  const result = evaluateHarness({ invoice });
  assert.equal(result.classification, "SUSPICIOUS");
  assert.ok(result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"));
});

for (const answer of ["Não", "Não sei"]) {
  test(`resposta ${answer} encerra como informação insuficiente`, () => {
    const result = evaluateHarness({
      invoice: aggregateInvoice(),
      contextAnswers: [{
        code: "SUPPORT_SET_COMPLETENESS",
        question: "Este arquivo contém todo o conjunto cobrado neste boleto?",
        type: "SINGLE_SELECT",
        value: answer,
      }],
    });
    assert.equal(result.classification, "INFORMATION_INSUFFICIENT");
    assert.equal(result.findings.length, 0);
  });
}

test("resposta sim permite reavaliar a ausência sem reler o arquivo", () => {
  const result = evaluateHarness({
    invoice: aggregateInvoice(),
    contextAnswers: [{
      code: "SUPPORT_SET_COMPLETENESS",
      question: "Este arquivo contém todo o conjunto cobrado neste boleto?",
      type: "SINGLE_SELECT",
      value: "Sim",
    }],
  });
  assert.equal(result.classification, "SUSPICIOUS");
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.code === "SUPPORT_DOCUMENTS_MISSING_FROM_CONFIRMED_SET",
    ),
    true,
  );
});

function reimbursementWithObservations(
  lineNumber: number,
  observations: NonNullable<
    HarnessInvoice["items"][number]["evidenceObservations"]
  >,
): HarnessInvoice {
  return {
    documentKind: "REIMBURSEMENT",
    documentNumber: null,
    supplierName: null,
    supplierTaxId: null,
    issuedAt: null,
    totalAmount: observations[0]?.amount ?? null,
    readConfidence: 0.99,
    warnings: [],
    markdown: "Ficha e comprovantes de uma despesa.",
    itemCoverage: completeCoverage(lineNumber),
    items: [{
      lineNumber,
      description: `Despesa ${lineNumber}`,
      countsTowardDocumentTotal: true,
      quantity: null,
      unitPrice: null,
      totalAmount: observations[0]?.amount ?? null,
      evidenceObservations: observations,
    }],
  };
}

test("item 12 permanece conflito neutro sem fonte esperada", () => {
  const rules = evaluateUniversalRules({
    invoice: reimbursementWithObservations(12, [
      { kind: "SHEET", documentGroup: "12", label: "Ficha", amount: "40.00", date: null, page: 1, text: "Ficha R$ 40,00" },
      { kind: "PAYMENT", documentGroup: "12", label: "Pagamento", amount: "40.00", date: null, page: 2, text: "Débito R$ 40,00" },
      { kind: "SALE", documentGroup: "12", label: "Venda", amount: "44.50", date: null, page: 2, text: "Total da venda R$ 44,50" },
    ]),
  });
  const finding = rules.findings.find((entry) =>
    entry.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_12"),
  );
  assert.equal(finding?.comparisonMode, "CONFLICT");
  assert.equal(finding?.expectedValue, null);
  assert.deepEqual(finding?.actualValue, ["40.00", "44.50"]);
});

test("item 19 usa ficha e recibo corroborados como referência", () => {
  const rules = evaluateUniversalRules({
    invoice: reimbursementWithObservations(19, [
      { kind: "SHEET", documentGroup: "19", label: "Ficha", amount: "18.00", date: null, page: 1, text: "Ficha R$ 18,00" },
      { kind: "RECEIPT", documentGroup: "19", label: "Recibo", amount: "18.00", date: null, page: 2, text: "Recibo R$ 18,00" },
      { kind: "PAYMENT", documentGroup: "19", label: "Pagamento", amount: "28.00", date: null, page: 2, text: "Débito R$ 28,00" },
    ]),
  });
  const finding = rules.findings.find((entry) =>
    entry.code.startsWith("EVIDENCE_AMOUNT_MISMATCH_19"),
  );
  assert.equal(finding?.comparisonMode, "REFERENCE");
  assert.equal(finding?.referenceBasis, "CORROBORATED_SHEET_AND_RECEIPT");
  assert.equal(finding?.expectedValue, "18.00");
  assert.equal(finding?.actualValue, "28.00");
});

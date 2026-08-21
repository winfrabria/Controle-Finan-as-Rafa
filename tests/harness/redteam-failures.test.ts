import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateHarness,
  evaluateUniversalRules,
  routeContextQuestions,
  type AiDiscoveryResponse,
  type HarnessInvoice,
} from "../../src/lib/audit-harness";

function baseInvoice(overrides: Partial<HarnessInvoice> = {}): HarnessInvoice {
  return {
    documentKind: "FISCAL_INVOICE",
    documentNumber: "123",
    supplierName: null,
    supplierTaxId: "11222333000181",
    issuedAt: "2026-08-01",
    totalAmount: "100",
    readConfidence: 0.95,
    warnings: [],
    markdown: "x".repeat(600),
    items: [],
    ...overrides,
  };
}

test("RT1 falso positivo: pagamento agregado reconciliado gera AGGREGATE_PAYMENT_MISMATCH", () => {
  const invoice = baseInvoice({
    documentKind: "COMPOSITE",
    items: [
      {
        lineNumber: 1,
        description: "Boleto consolidado da obra",
        documentRole: "AGGREGATE_PAYMENT",
        documentGroup: "g1",
        quantity: null,
        unitPrice: null,
        totalAmount: "100",
        evidenceObservations: [
          { kind: "PAYMENT", documentGroup: "g1", label: "boleto", amount: "100", date: "2026-08-01", page: 1, text: null },
        ],
      },
      {
        lineNumber: 2,
        description: "NF-e suporte A",
        documentRole: "SUPPORTING_DOCUMENT",
        documentGroup: "g1",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "60",
        totalAmount: "60",
        evidenceObservations: [
          { kind: "RECEIPT", documentGroup: "g1", label: "nf a", amount: "60", date: "2026-08-01", page: 1, text: null },
        ],
      },
      {
        lineNumber: 3,
        description: "NF-e suporte B",
        documentRole: "SUPPORTING_DOCUMENT",
        documentGroup: "g1",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "40",
        totalAmount: "40",
        evidenceObservations: [
          { kind: "RECEIPT", documentGroup: "g1", label: "nf b", amount: "40", date: "2026-08-01", page: 1, text: null },
        ],
      },
    ],
  });
  const result = evaluateUniversalRules({ invoice });
  const mismatch = result.findings.filter((finding) =>
    finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH"),
  );
  assert.equal(mismatch.length, 0, `esperado nenhum achado; obtido: ${mismatch.map((f) => f.code).join(", ")}`);
});

test("RT2 falso positivo: dois pagamentos parciais comparados só com a primeira parcela", () => {
  const invoice = baseInvoice({
    documentKind: "COMPOSITE",
    items: [
      {
        lineNumber: 1,
        description: "NF-e suporte A",
        documentRole: "SUPPORTING_DOCUMENT",
        documentGroup: "g1",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "60",
        totalAmount: "60",
        evidenceObservations: [
          { kind: "PAYMENT", documentGroup: "g1", label: "pix 1", amount: "60", date: "2026-08-01", page: 1, text: null },
        ],
      },
      {
        lineNumber: 2,
        description: "NF-e suporte B",
        documentRole: "SUPPORTING_DOCUMENT",
        documentGroup: "g1",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "40",
        totalAmount: "40",
        evidenceObservations: [
          { kind: "PAYMENT", documentGroup: "g1", label: "pix 2", amount: "40", date: "2026-08-01", page: 2, text: null },
        ],
      },
    ],
  });
  const result = evaluateUniversalRules({ invoice });
  const mismatch = result.findings.filter((finding) =>
    finding.code.startsWith("AGGREGATE_PAYMENT_MISMATCH"),
  );
  assert.equal(mismatch.length, 0, `pagamentos 60+40=100 reconciliam; obtido: ${mismatch.map((f) => f.code).join(", ")}`);
});

test("RT3 falso negativo: camada explícita toda false silencia TOTAL_MISMATCH mesmo com cobertura COMPLETE", () => {
  const invoice = baseInvoice({
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 2,
      firstLineNumber: 1,
      lastLineNumber: 2,
      missingLineNumbers: [],
      evidence: null,
    },
    items: [
      {
        lineNumber: 1,
        description: "Item A",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "60",
        totalAmount: "60",
      },
      {
        lineNumber: 2,
        description: "Item B",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "30",
        totalAmount: "30",
      },
    ],
  });
  const result = evaluateUniversalRules({ invoice });
  assert.ok(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    "TOTAL_MISMATCH deveria disparar (60+30 != 100) com cobertura COMPLETE",
  );
});

test("RT4 falso negativo: palavra 'desconto' sem valor suprime ITEM_ARITHMETIC_MISMATCH", () => {
  const invoice = baseInvoice({
    items: [
      {
        lineNumber: 1,
        description: "Servico com desconto aplicado no fechamento da conta",
        quantity: "2",
        unitPrice: "50",
        totalAmount: "80",
      },
    ],
  });
  const result = evaluateUniversalRules({ invoice });
  assert.ok(
    result.findings.some((finding) => finding.code === "ITEM_ARITHMETIC_MISMATCH"),
    "2x50=100 contra total 80 deveria gerar ITEM_ARITHMETIC_MISMATCH",
  );
});

test("RT5 falso negativo: formatação do total impede detecção de duplicata exata", () => {
  const invoice = baseInvoice({ totalAmount: "1000.00" });
  const result = evaluateUniversalRules({
    invoice,
    duplicates: [
      {
        noteId: "nota-anterior",
        documentNumber: "123",
        supplierTaxId: "11222333000181",
        issuedAt: "2026-08-01",
        totalAmount: "1000",
      },
    ],
  });
  assert.ok(
    result.findings.some((finding) => finding.code === "POSSIBLE_DUPLICATE"),
    "mesma nota (numero/fornecedor/data/valor) deveria ser detectada como duplicata",
  );
});

test("RT6 duplicação semântica: contradição já coberta por regra determinística é promulgada de novo", () => {
  const invoice = baseInvoice({
    documentKind: "REIMBURSEMENT",
    items: [
      {
        lineNumber: 1,
        description: "Refeicao",
        quantity: "1",
        unitPrice: "28",
        totalAmount: "28",
        evidenceObservations: [
          { kind: "SHEET", documentGroup: "d1", label: "ficha", amount: "28", date: "2026-08-01", page: 1, text: null },
          { kind: "RECEIPT", documentGroup: "d1", label: "recibo", amount: "18", date: "2026-08-01", page: 2, text: null },
        ],
      },
    ],
  });
  const aiDiscovery = {
    findings: [],
    coverage: { sufficientEvidence: true, checkedAreas: ["AMOUNTS"], limitations: [] },
    contextQuestions: [
      {
        code: "q_valor",
        options: [],
        prompt: "Por que o recibo mostra R$ 18,00 enquanto a ficha registra R$ 28,00?",
        rationale: "Divergencia entre registros do proprio anexo.",
        required: false,
        type: "TEXT" as const,
      },
    ],
    needsContext: true,
    summary: "analise concluida",
  } satisfies AiDiscoveryResponse;
  const result = evaluateHarness({ invoice, aiDiscovery });
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(
    codes.includes("EVIDENCE_AMOUNT_MISMATCH_1"),
    "regra deterministica deve apontar a divergencia",
  );
  const promoted = codes.filter((code) => code.startsWith("INTERNAL_CONTRADICTION"));
  assert.deepEqual(
    promoted,
    [],
    `contradicao ja coberta deterministicamente nao deveria ser promulgada novamente; obtido: ${codes.join(", ")}`,
  );
});

test("RT7 pergunta de contexto legítima convertida em achado por regex genérica", () => {
  const promoted = routeContextQuestions([
    {
      code: "q_limite",
      options: [],
      prompt:
        "Se a obra autorizou limite de R$ 500,00 para a despesa e a nota totaliza R$ 480,00, existe aprovacao adicional pendente?",
      rationale: "Fato externo: parametro da obra nao presente no anexo.",
      required: true,
      type: "TEXT",
    },
  ]);
  assert.deepEqual(
    promoted.promotedFindings.map((finding) => finding.code),
    [],
    "pergunta sobre fato externo legitimo nao deveria virar INTERNAL_CONTRADICTION",
  );
});

test("RT8 falso negativo: gap de cobertura em um grupo suprime TOTAL_MISMATCH de outro grupo", () => {
  const invoice = baseInvoice({
    documentKind: "COMPOSITE",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 4,
      extractedItemCount: 4,
      firstLineNumber: 1,
      lastLineNumber: 4,
      missingLineNumbers: [],
      evidence: null,
    },
    items: [
      {
        lineNumber: 1,
        description: "Boleto obra A agrupando documentos",
        documentRole: "AGGREGATE_PAYMENT",
        documentGroup: "obra-a",
        quantity: null,
        unitPrice: null,
        totalAmount: "200",
        evidenceObservations: [
          { kind: "PAYMENT", documentGroup: "obra-a", label: "boleto", amount: "200", date: "2026-08-01", page: 1, text: null },
        ],
      },
      {
        lineNumber: 2,
        description: "NF-e suporte obra A parcial",
        documentRole: "SUPPORTING_DOCUMENT",
        documentGroup: "obra-a",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "50",
        totalAmount: "50",
      },
      {
        lineNumber: 3,
        description: "Item fiscal C",
        documentRole: "LINE_ITEM",
        countsTowardDocumentTotal: true,
        quantity: "1",
        unitPrice: "100",
        totalAmount: "100",
      },
      {
        lineNumber: 4,
        description: "Item fiscal D",
        documentRole: "LINE_ITEM",
        countsTowardDocumentTotal: true,
        quantity: "1",
        unitPrice: "150",
        totalAmount: "150",
      },
    ],
  });
  const universal = evaluateUniversalRules({ invoice });
  assert.ok(
    universal.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    "camada fiscal completa soma 200 contra total 250; TOTAL_MISMATCH deveria existir antes da precedência",
  );
  const result = evaluateHarness({ invoice });
  assert.ok(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    "TOTAL_MISMATCH de outro grupo documental nao deveria ser descartado pelo gap do grupo obra-a",
  );
});

test("RT9 falso positivo: TOTAL_MISMATCH da IA escapa com cobertura INCOMPLETE", () => {
  const result = evaluateHarness({
    invoice: {
      documentKind: "COMPOSITE",
      documentNumber: "SYNTHETIC-RT9",
      supplierName: "Fornecedor sintético",
      supplierTaxId: null,
      issuedAt: "2026-01-01",
      totalAmount: "100.00",
      readConfidence: 0.95,
      warnings: [],
      markdown: "Documento sintético com cobertura parcial para provar a guarda determinística do total. ".repeat(8),
      itemCoverage: {
        status: "INCOMPLETE",
        declaredItemCount: 3,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 2,
        missingLineNumbers: [3],
        evidence: "A terceira linha não foi extraída.",
      },
      items: [
        { lineNumber: 1, description: "Item A", quantity: "1", unitPrice: "30.00", totalAmount: "30.00" },
        { lineNumber: 2, description: "Item B", quantity: "1", unitPrice: "20.00", totalAmount: "20.00" },
      ],
    },
    aiDiscovery: {
      findings: [{
        code: "TOTAL_MISMATCH",
        title: "Total divergente",
        description: "A soma extraída não coincide com o total.",
        category: "TOTALS",
        severity: "WARNING",
        source: "AI_DISCOVERY",
        confidence: 0.95,
        justification: "A soma das linhas extraídas é inferior ao total informado.",
        references: ["DOCUMENTO:total"],
        evidence: { field: "totalAmount", page: 1, summary: "Itens extraídos somam 50 e total informa 100." },
        expectedValue: "50.00",
        actualValue: "100.00",
        noteItemLineNumber: null,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["TOTALS"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "Auditoria sintética.",
    },
  });

  assert.equal(
    result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"),
    false,
    "TOTAL_MISMATCH deve ser bloqueado para qualquer fonte quando a cobertura não é COMPLETE",
  );
  assert.notEqual(result.classification, "SUSPICIOUS");
});

import assert from "node:assert/strict";
import test from "node:test";

import type { HarnessInvoice } from "./contracts";
import {
  decideClassification,
  resolvePostContextClassification,
} from "./decision-matrix";
import {
  deduplicateHarnessFindings,
  evaluateHarness,
  routeContextQuestions,
} from "./engine";
import { isReadFailure } from "./policy";

const sparseInvoice: HarnessInvoice = {
  documentNumber: null,
  supplierName: "Fornecedor",
  supplierTaxId: null,
  issuedAt: null,
  totalAmount: "10.00",
  readConfidence: 0.95,
  warnings: [],
  markdown: "",
  items: [],
};

test("prioriza READ_FAILED e não inventa contexto sem pergunta concreta", () => {
  assert.equal(decideClassification({ readFailed: true, deterministicCoverage: true, aiCoverage: true, findings: [] }), "READ_FAILED");
  assert.equal(evaluateHarness({ invoice: sparseInvoice }).classification, "OK");
  assert.equal(evaluateHarness({ invoice: { ...sparseInvoice, readConfidence: 0.3 } }).classification, "READ_FAILED");
});

test("reembolso composto legível segue para auditoria mesmo sem identidade única", () => {
  const reimbursement: HarnessInvoice = {
    documentNumber: null,
    supplierName: null,
    supplierTaxId: null,
    issuedAt: null,
    totalAmount: "551.90",
    readConfidence: 0.97,
    warnings: ["Documento é uma ficha de reembolso com múltiplos fornecedores e comprovantes."],
    markdown: "Ficha de reembolso com 22 comprovantes.",
    items: Array.from({ length: 22 }, (_, index) => ({
      lineNumber: index + 1,
      description: `Despesa ${index + 1}`,
      quantity: "1",
      unitPrice: "25.00",
      totalAmount: "25.00",
    })),
  };

  assert.equal(isReadFailure(reimbursement), false);
  assert.notEqual(evaluateHarness({ invoice: reimbursement }).classification, "READ_FAILED");
});

test("confiança zero não descarta reembolso composto com extração materialmente rica", () => {
  const reimbursement: HarnessInvoice = {
    documentNumber: null,
    supplierName: null,
    supplierTaxId: null,
    issuedAt: "2026-06-01",
    totalAmount: "551.90",
    readConfidence: 0,
    warnings: [],
    markdown:
      "Ficha de reembolso com múltiplos comprovantes. ".repeat(12) +
      "Total consolidado R$ 551,90.",
    items: Array.from({ length: 22 }, (_, index) => ({
      lineNumber: index + 1,
      description: `Comprovante ${index + 1} da ficha de reembolso`,
      quantity: "1",
      unitPrice: "25.00",
      totalAmount: "25.00",
    })),
  };

  assert.equal(isReadFailure(reimbursement), false);
  assert.notEqual(evaluateHarness({ invoice: reimbursement }).classification, "READ_FAILED");
});

test("confiança baixa continua falhando quando não há evidência estrutural suficiente", () => {
  assert.equal(
    isReadFailure({
      ...sparseInvoice,
      readConfidence: 0,
      markdown: "Valor isolado e sem estrutura suficiente.",
    }),
    true,
  );
});

test("achado sustentado warning exige classificação suspeita", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: false,
    aiCoverage: false,
    findings: [{
      code: "X", title: "X", description: "X", category: "X", severity: "WARNING",
      source: "AI_DISCOVERY", confidence: 0.8, justification: "Evidência objetiva.",
      references: ["DANFE:campo:value"],
      evidence: { field: "value", summary: "O campo diverge do documento." }, expectedValue: null, actualValue: "value",
      noteItemLineNumber: null,
    }],
  }), "SUSPICIOUS");
});

test("observação informativa da IA não transforma uma nota em suspeita", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: true,
    findings: [{
      code: "FISCAL_AGGREGATION", title: "Agregação fiscal", description: "O total confere.", category: "FORMAT",
      severity: "INFO", source: "AI_DISCOVERY", confidence: 0.99,
      justification: "A unidade fiscal agrega o detalhamento operacional sem divergência de valor.",
      references: ["DANFE:página:1"], evidence: { page: 1, summary: "1 UN de R$ 350 corresponde a 14 refeições de R$ 25." },
      expectedValue: "350.00", actualValue: "350.00", noteItemLineNumber: null,
    }],
  }), "OK");
});

test("observação informativa da IA não é persistida como achado do revisor", () => {
  const result = evaluateHarness({
    invoice: sparseInvoice,
    aiDiscovery: {
      findings: [{
        code: "FORMAT_NOTE",
        title: "Observação de formato",
        description: "O documento usa uma apresentação diferente, mas os valores conferem.",
        category: "FORMAT",
        severity: "INFO",
        source: "AI_DISCOVERY",
        confidence: 0.95,
        justification: "Não existe divergência financeira comprovada.",
        references: ["DOCUMENTO:página:1"],
        evidence: { field: "formato", summary: "Apresentação agregada e reconciliada." },
        expectedValue: "Valores reconciliados",
        actualValue: "Valores reconciliados",
        noteItemLineNumber: null,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["FORMAT"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "Documento reconciliado.",
    },
  });

  assert.equal(result.classification, "OK");
  assert.equal(result.findings.length, 0);
});

test("variação textual de nome sem duas identidades fiscais não vira suspeita", () => {
  const result = evaluateHarness({
    invoice: sparseInvoice,
    aiDiscovery: {
      findings: [{
        code: "BENEFICIARY_NAME_VARIATION",
        title: "Nome do beneficiário diverge do fornecedor",
        description: "O boleto abrevia o nome usado no documento fiscal.",
        category: "BENEFICIARY",
        severity: "WARNING",
        source: "AI_DISCOVERY",
        confidence: 0.91,
        justification: "Os nomes têm grafia diferente.",
        references: ["DOCUMENTO:página:1", "BOLETO:página:2"],
        evidence: { field: "beneficiário", summary: "Um registro usa nome abreviado." },
        expectedValue: "Fornecedor Comércio Ltda.",
        actualValue: "Fornecedor Ltda.",
        noteItemLineNumber: null,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["IDENTITY"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "Foi observada uma abreviação textual.",
    },
  });

  assert.equal(result.classification, "OK");
  assert.equal(result.findings.length, 0);
});

test("associação de placa e equipamento sem cadastro ativo não vira suspeita", () => {
  const result = evaluateHarness({
    invoice: sparseInvoice,
    aiDiscovery: {
      findings: [{
        code: "ASSET_LABEL_CONFLICT",
        title: "Placa associada a equipamentos diferentes",
        description: "O mesmo identificador aparece com dois rótulos operacionais.",
        category: "EQUIPMENT",
        severity: "WARNING",
        source: "AI_DISCOVERY",
        confidence: 0.88,
        justification: "Os rótulos do equipamento não são iguais.",
        references: ["CONTROLE:página:1"],
        evidence: { field: "placa", summary: "O controle usa dois rótulos para a mesma placa." },
        expectedValue: "Um equipamento por placa",
        actualValue: "Dois rótulos operacionais",
        noteItemLineNumber: null,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["EQUIPMENT"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "O controle usa rótulos operacionais diferentes.",
    },
  });

  assert.equal(result.classification, "OK");
  assert.equal(result.findings.length, 0);
});

test("divergência objetiva com valores e localização continua sustentando suspeita", () => {
  const result = evaluateHarness({
    invoice: sparseInvoice,
    aiDiscovery: {
      findings: [{
        code: "DOCUMENT_AMOUNT_MISMATCH",
        title: "Valores divergentes no documento",
        description: "O valor registrado na ficha não coincide com o comprovante.",
        category: "AMOUNTS",
        severity: "WARNING",
        source: "AI_DISCOVERY",
        confidence: 0.94,
        justification: "Os dois valores estão legíveis e pertencem à mesma despesa.",
        references: ["FICHA:página:1", "COMPROVANTE:página:2"],
        evidence: { field: "valor", page: 2, summary: "Ficha e comprovante registram valores diferentes." },
        expectedValue: "100.00",
        actualValue: "120.00",
        noteItemLineNumber: 1,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["AMOUNTS"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "Uma divergência objetiva foi confirmada.",
    },
  });

  assert.equal(result.classification, "SUSPICIOUS");
  assert.equal(result.findings.length, 1);
});

test("pergunta de contexto permanece quando a observação da IA é apenas informativa", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: true,
    contextRequired: true,
    contextQuestions: 1,
    findings: [{
      code: "VOLTAGE_CONTEXT", title: "Tensões diferentes", description: "Pode haver destinos distintos.", category: "COMPATIBILITY",
      severity: "INFO", source: "AI_DISCOVERY", confidence: 0.9,
      justification: "É preciso confirmar o equipamento de destino antes de concluir incompatibilidade.",
      references: ["DANFE:item:1"], evidence: { lineNumber: 1, summary: "A nota contém itens de 127 V e 220 V." },
      expectedValue: null, actualValue: "127 V e 220 V", noteItemLineNumber: 1,
    }],
  }), "NEEDS_CONTEXT");
});

test("achado livre sustentado vai direto para suspeita mesmo com pergunta acessória", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: true,
    contextRequired: true,
    contextQuestions: 1,
    findings: [{
      code: "PAYMENT_MISMATCH", title: "Valores divergentes", description: "A venda e o pagamento divergem.", category: "AMOUNTS",
      severity: "WARNING", source: "AI_DISCOVERY", confidence: 0.9,
      justification: "Os dois valores estão visíveis no mesmo anexo.", references: [],
      evidence: { field: "valor", summary: "Venda de R$ 44,50 e pagamento de R$ 40,00." },
      expectedValue: "R$ 44,50", actualValue: "R$ 40,00", noteItemLineNumber: null,
    }],
  }), "SUSPICIOUS");
});

test("lacuna de cobertura impede falso total divergente e deduplica a mesma diferença", () => {
  const result = evaluateHarness({
    invoice: {
      ...sparseInvoice,
      documentKind: "COMPOSITE",
      totalAmount: "100.00",
      items: [{
        lineNumber: 12,
        description: "Item parcialmente extraído",
        quantity: "1",
        unitPrice: "44.50",
        totalAmount: "40.00",
        evidenceObservations: [
          { kind: "SALE", label: "Venda", amount: "44.50", date: null, page: 13, text: "Venda" },
          { kind: "PAYMENT", label: "Pagamento", amount: "40.00", date: null, page: 13, text: "Pagamento" },
        ],
      }],
    },
    aiDiscovery: {
      findings: [{
        code: "COMPOSITE_DETAIL_COVERAGE_GAP",
        title: "Cobertura incompleta",
        description: "Ainda faltam linhas anunciadas na ficha.",
        category: "DOCUMENT_COVERAGE",
        severity: "INFO",
        source: "AI_DISCOVERY",
        confidence: 1,
        justification: "A extração termina antes das linhas referenciadas.",
        references: ["DOCUMENTO:página:1"],
        evidence: { page: 1, summary: "Faltam linhas 25 a 37." },
        expectedValue: "Linhas 1 a 37",
        actualValue: "Linhas 1 a 24",
        noteItemLineNumber: null,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["COVERAGE"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "Cobertura parcial.",
    },
  });

  assert.equal(result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"), false);
  assert.equal(result.findings.some((finding) => finding.code === "ITEM_ARITHMETIC_MISMATCH"), false);
  assert.equal(result.findings.some((finding) => finding.code === "EVIDENCE_AMOUNT_MISMATCH_12"), true);
});

test("achado determinístico comprovado vai direto para suspeita mesmo com pergunta acessória", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: true,
    contextRequired: true,
    contextQuestions: 1,
    findings: [{
      code: "TOTAL_MISMATCH", title: "Total divergente", description: "A soma não confere.", category: "TOTALS",
      severity: "CRITICAL", source: "UNIVERSAL_RULE", confidence: 0.99,
      justification: "A diferença excede a tolerância configurada.", references: ["DANFE:total"],
      evidence: { field: "totalAmount", summary: "Itens somam 100 e a nota informa 150." },
      expectedValue: "100.00", actualValue: "150.00", noteItemLineNumber: null,
    }],
  }), "SUSPICIOUS");
});

test("achado livre sem localização e evidência concreta não sustenta suspeita", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: true,
    findings: [{
      code: "X", title: "X", description: "X", category: "X", severity: "WARNING",
      source: "AI_DISCOVERY", confidence: 0.99, justification: "Parece inconsistente.",
      references: [], evidence: { field: "" }, expectedValue: null, actualValue: null,
      noteItemLineNumber: null,
    }],
  }), "OK");
});

test("contexto necessário não vira suspeita sem achado sustentado", () => {
  assert.equal(decideClassification({
    readFailed: false,
    deterministicCoverage: true,
    aiCoverage: false,
    contextRequired: true,
    contextQuestions: 1,
    findings: [],
  }), "NEEDS_CONTEXT");
});

test("reanálise após contexto sempre termina em OK ou suspeita", () => {
  assert.equal(resolvePostContextClassification({
    deterministicCoverage: false,
    aiCoverage: false,
    findings: [],
  }), "OK");

  assert.equal(resolvePostContextClassification({
    deterministicCoverage: false,
    aiCoverage: true,
    findings: [{
      code: "CTX-CONFIRMED", title: "Divergência confirmada", description: "O valor diverge.", category: "TOTALS",
      severity: "WARNING", source: "AI_DISCOVERY", confidence: 0.9,
      justification: "A resposta confirmou a divergência observada.", references: ["DANFE:total"],
      evidence: { field: "totalAmount", summary: "O total informado não confere." },
      expectedValue: "100.00", actualValue: "150.00", noteItemLineNumber: null,
    }],
  }), "SUSPICIOUS");
});

const objectiveQuestions = [
  {
    code: "CTX-DATE-FAZENDINHA",
    options: [],
    prompt: "Por que a ficha registra a despesa do Restaurante Fazendinha em 19/05/2026, se o pedido e o pagamento de R$ 15,00 são de 18/05/2026?",
    rationale: "A ficha e o comprovante apresentam datas diferentes.",
    required: true,
    type: "TEXT" as const,
  },
  {
    code: "CTX-AMOUNT-JEQUITAI",
    options: [],
    prompt: "A venda da trena no Depósito Jequitaí, de R$ 44,50, recebeu desconto, cancelamento parcial ou outro ajuste para resultar no pagamento de R$ 40,00?",
    rationale: "O valor da venda e o valor pago divergem.",
    required: true,
    type: "TEXT" as const,
  },
  {
    code: "CTX-AMOUNT-UVA",
    options: [],
    prompt: "Por que o cartão da Casa da Uva registra R$ 28,00 em 27/05/2026, enquanto o recibo e a ficha solicitam R$ 18,00?",
    rationale: "Os valores do cartão e da ficha são diferentes.",
    required: true,
    type: "TEXT" as const,
  },
];

test("converte divergências internas de data e valor em achados, não perguntas", () => {
  const routed = routeContextQuestions(objectiveQuestions);

  assert.equal(routed.contextQuestions.length, 0);
  assert.equal(routed.promotedFindings.length, 3);
  assert.deepEqual(
    routed.promotedFindings.map((finding) => finding.category),
    ["DATES", "AMOUNTS", "AMOUNTS"],
  );
  assert.ok(routed.promotedFindings.every((finding) => finding.severity === "WARNING"));
});

test("as três divergências do reembolso resultam em suspeita sem rodada pública", () => {
  const result = evaluateHarness({
    invoice: sparseInvoice,
    aiDiscovery: {
      findings: [],
      coverage: {
        sufficientEvidence: true,
        checkedAreas: ["REIMBURSEMENT"],
        limitations: [],
      },
      contextQuestions: objectiveQuestions,
      needsContext: true,
      summary: "Foram identificadas divergências internas.",
    },
  });

  assert.equal(result.classification, "SUSPICIOUS");
  assert.equal(result.contextQuestions.length, 0);
  assert.equal(result.findings.length, 3);
});

test("pergunta sobre fato externo continua como contexto", () => {
  const externalQuestion = {
    code: "CTX-HEADCOUNT",
    options: [],
    prompt: "Quantas pessoas foram atendidas pelas 40 refeições registradas?",
    rationale: "O número de pessoas não está informado no anexo.",
    required: true,
    type: "NUMBER" as const,
  };
  const routed = routeContextQuestions([externalQuestion]);
  assert.equal(routed.contextQuestions.length, 1);
  assert.equal(routed.promotedFindings.length, 0);

  const result = evaluateHarness({
    invoice: sparseInvoice,
    aiDiscovery: {
      findings: [],
      coverage: {
        sufficientEvidence: false,
        checkedAreas: ["MEALS"],
        limitations: ["Quantidade de pessoas ausente."],
      },
      contextQuestions: [externalQuestion],
      needsContext: true,
      summary: "É necessário confirmar o número de pessoas.",
    },
  });
  assert.equal(result.classification, "NEEDS_CONTEXT");
  assert.equal(result.contextQuestions.length, 1);
});

test("resposta genérica não apaga contradição objetiva já comprovada", () => {
  const routed = routeContextQuestions(objectiveQuestions);
  assert.equal(resolvePostContextClassification({
    deterministicCoverage: true,
    aiCoverage: true,
    findings: routed.promotedFindings,
  }), "SUSPICIOUS");
});

test("remove repetições semânticas do mesmo achado e preserva itens distintos", () => {
  const base = {
    actualValue: "40.00",
    category: "TOTALS",
    code: "PAYMENT_MISMATCH",
    evidence: {
      lineNumber: 12,
      page: 13,
      summary: "O valor pago diverge do valor do documento.",
    },
    expectedValue: "44.50",
    noteItemLineNumber: 12,
  };

  assert.equal(
    deduplicateHarnessFindings([
      base,
      { ...base, code: "AI_PAYMENT_DIFFERENCE" },
    ]).length,
    1,
  );
  assert.equal(
    deduplicateHarnessFindings([
      base,
      {
        ...base,
        noteItemLineNumber: 19,
        evidence: {
          lineNumber: 19,
          page: 20,
          summary: "O valor pago diverge do valor do documento.",
        },
      },
    ]).length,
    2,
  );
});

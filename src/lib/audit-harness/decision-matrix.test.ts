import assert from "node:assert/strict";
import test from "node:test";

import type { AiDiscoveryResponse, HarnessInvoice } from "./contracts";
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

test("reembolso legível sem despesas extraídas termina como informação insuficiente", () => {
  const emptyReimbursement: HarnessInvoice = {
    ...sparseInvoice,
    documentKind: "REIMBURSEMENT",
    markdown: "Ficha de reembolso e prestação de contas integralmente legível.",
    totalAmount: "500.00",
  };

  assert.equal(isReadFailure(emptyReimbursement), false);
  assert.equal(
    evaluateHarness({ invoice: emptyReimbursement }).classification,
    "INFORMATION_INSUFFICIENT",
  );
});

test("nota fiscal legível sem linhas extraídas termina como informação insuficiente", () => {
  const emptyInvoice: HarnessInvoice = {
    ...sparseInvoice,
    documentKind: "FISCAL_INVOICE",
    markdown: "Nota fiscal legível com total declarado, mas sem linhas extraídas.",
    totalAmount: "500.00",
  };

  assert.equal(isReadFailure(emptyInvoice), false);
  assert.equal(
    evaluateHarness({ invoice: emptyInvoice }).classification,
    "INFORMATION_INSUFFICIENT",
  );
});

test("camada total explicitamente vazia termina como informação insuficiente", () => {
  const invalidLayer: HarnessInvoice = {
    ...sparseInvoice,
    totalAmount: "100.00",
    markdown: "Documento sintético com total e duas linhas extraídas.",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 2,
      firstLineNumber: 1,
      lastLineNumber: 2,
      missingLineNumbers: [],
      evidence: "A extração declarou cobertura completa.",
    },
    items: [
      {
        lineNumber: 1,
        description: "Linha sintética A",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "60.00",
        totalAmount: "60.00",
      },
      {
        lineNumber: 2,
        description: "Linha sintética B",
        countsTowardDocumentTotal: false,
        quantity: "1",
        unitPrice: "30.00",
        totalAmount: "30.00",
      },
    ],
  };

  assert.equal(isReadFailure(invalidLayer), false);
  assert.equal(
    evaluateHarness({ invoice: invalidLayer }).classification,
    "INFORMATION_INSUFFICIENT",
  );
});

test("documento OTHER legível é aceito e auditado sem bloqueio por categoria", () => {
  const readableOther: HarnessInvoice = {
    ...sparseInvoice,
    documentKind: "OTHER",
    documentNumber: "DOC-1",
    markdown: "Documento comercial legível com identificação e valor.",
  };

  assert.equal(isReadFailure(readableOther), false);
  assert.equal(evaluateHarness({ invoice: readableOther }).classification, "OK");
});

test("documento OTHER legível sem base auditável termina como informação insuficiente", () => {
  const insufficientOther: HarnessInvoice = {
    ...sparseInvoice,
    documentKind: "OTHER",
    documentNumber: null,
    supplierName: null,
    totalAmount: null,
    markdown: "Texto legível, mas sem identidade, valor ou itens auditáveis.",
  };

  assert.equal(isReadFailure(insufficientOther), false);
  assert.equal(
    evaluateHarness({ invoice: insufficientOther }).classification,
    "INFORMATION_INSUFFICIENT",
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
        evidence: { field: "formato", source: "DOCUMENTO:página:1", page: 1, lineNumber: null, summary: "Apresentação agregada e reconciliada." },
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
        evidence: { field: "beneficiário", source: "DOCUMENTO:página:1", page: 1, lineNumber: null, summary: "Um registro usa nome abreviado." },
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
        evidence: { field: "identificador", source: "CONTROLE:página:1", page: 1, lineNumber: null, summary: "O controle usa dois rótulos para o mesmo identificador." },
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
        evidence: { field: "valor", source: "COMPROVANTE:página:2", page: 2, lineNumber: null, summary: "Ficha e comprovante registram valores diferentes." },
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
        evidence: { field: null, source: "DOCUMENTO:página:1", page: 1, lineNumber: null, summary: "Faltam linhas 25 a 37." },
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

test("não aceita TOTAL_MISMATCH da IA com cobertura COMPLETE mas linhas ausentes", () => {
  const result = evaluateHarness({
    invoice: {
      ...sparseInvoice,
      documentKind: "FISCAL_INVOICE",
      totalAmount: "100.00",
      itemCoverage: {
        status: "COMPLETE",
        declaredItemCount: 2,
        extractedItemCount: 2,
        firstLineNumber: 1,
        lastLineNumber: 3,
        missingLineNumbers: [2],
        evidence: "O provedor marcou a camada como completa, mas a linha 2 não foi extraída.",
      },
      items: [{
        lineNumber: 1,
        description: "Linha extraída",
        quantity: "1",
        unitPrice: "80.00",
        totalAmount: "80.00",
      }, {
        lineNumber: 3,
        description: "Linha extraída após a lacuna",
        quantity: "1",
        unitPrice: "20.00",
        totalAmount: "20.00",
      }],
    },
    aiDiscovery: {
      findings: [{
        code: "TOTAL_MISMATCH",
        title: "Total divergente",
        description: "A soma informada pelo avaliador não confere.",
        category: "TOTALS",
        severity: "CRITICAL",
        source: "AI_DISCOVERY",
        confidence: 0.99,
        justification: "A divergência foi calculada sobre uma camada declarada como completa.",
        references: ["DOCUMENTO:total"],
        evidence: {
          field: "totalAmount",
          source: null,
          page: null,
          lineNumber: null,
          summary: "A soma dos itens diverge do total do documento.",
        },
        expectedValue: "100.00",
        actualValue: "80.00",
        noteItemLineNumber: null,
      }],
      coverage: { sufficientEvidence: true, checkedAreas: ["TOTALS"], limitations: [] },
      contextQuestions: [],
      needsContext: false,
      summary: "Total divergente.",
    },
  });

  assert.equal(result.findings.some((finding) => finding.code === "TOTAL_MISMATCH"), false);
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

test("needsContext sem pergunta termina como informação insuficiente, não como polling infinito", () => {
  const result = evaluateHarness({
    invoice: {
      ...sparseInvoice,
      markdown: "Documento legível com dados financeiros, mas sem a informação externa necessária.",
    },
    aiDiscovery: {
      findings: [],
      coverage: { sufficientEvidence: false, checkedAreas: ["CONTEXT"], limitations: ["Falta um dado externo."] },
      contextQuestions: [],
      needsContext: true,
      summary: "Ainda falta contexto, mas não há pergunta pública nova.",
    },
  });

  assert.equal(result.contextQuestions.length, 0);
  assert.equal(result.classification, "INFORMATION_INSUFFICIENT");
});

test("reanálise após contexto termina em informação insuficiente ou suspeita", () => {
  assert.equal(resolvePostContextClassification({
    deterministicCoverage: false,
    aiCoverage: false,
    findings: [],
    informationInsufficient: true,
  }), "INFORMATION_INSUFFICIENT");

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
    code: "CTX-INTERNAL-DATE",
    options: [],
    prompt: "Por que a ficha sintética registra a despesa em 11/08/2026, se o pedido e o pagamento de R$ 10,00 são de 10/08/2026?",
    rationale: "A ficha e o comprovante apresentam datas diferentes.",
    required: true,
    type: "TEXT" as const,
  },
  {
    code: "CTX-INTERNAL-AMOUNT-A",
    options: [],
    prompt: "A venda sintética de R$ 45,00 recebeu desconto, cancelamento parcial ou outro ajuste para resultar no pagamento de R$ 40,00?",
    rationale: "O valor da venda e o valor pago divergem.",
    required: true,
    type: "TEXT" as const,
  },
  {
    code: "CTX-INTERNAL-AMOUNT-B",
    options: [],
    prompt: "Por que o cartão sintético registra R$ 30,00 em 12/08/2026, enquanto o recibo e a ficha solicitam R$ 20,00?",
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

test("dois valores em pergunta de autorização externa não viram contradição", () => {
  const externalQuestion = {
    code: "CTX-LIMIT-AUTHORIZATION",
    options: [],
    prompt:
      "Se a obra autorizou limite de R$ 500,00 e a nota totaliza R$ 480,00, existe aprovação adicional pendente?",
    rationale: "Fato externo: parâmetro da obra não presente no anexo.",
    required: true,
    type: "TEXT" as const,
  };

  const routed = routeContextQuestions([externalQuestion]);
  assert.deepEqual(routed.contextQuestions, [externalQuestion]);
  assert.deepEqual(routed.promotedFindings, []);
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

function reimbursementWithAiAmountFinding(options: {
  aiGroup: string;
  aiLineNumber?: number | null;
  deterministicGroup: string;
  formattedAiValues?: boolean;
}) {
  const invoice: HarnessInvoice = {
    documentKind: "REIMBURSEMENT",
    documentNumber: "SYNTH-REIMBURSEMENT",
    supplierName: null,
    supplierTaxId: null,
    issuedAt: "2026-05-27",
    totalAmount: "18.00",
    readConfidence: 0.99,
    warnings: [],
    markdown: "Ficha de reembolso, recibo e pagamento integralmente lidos.",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 2,
      firstLineNumber: 19,
      lastLineNumber: 20,
      missingLineNumbers: [],
      evidence: "Linhas 19 e 20 conferidas.",
    },
    items: [
      {
        lineNumber: 19,
        description: "Despesa registrada na ficha",
        documentGroup: options.deterministicGroup,
        documentRole: "LINE_ITEM",
        countsTowardDocumentTotal: true,
        quantity: "1",
        unitPrice: "18.00",
        totalAmount: "18.00",
        evidenceObservations: [
          {
            kind: "SHEET",
            documentGroup: options.deterministicGroup,
            label: "Ficha item 19",
            amount: "18.00",
            date: "2026-05-26",
            page: 1,
            text: "Despesa R$ 18,00",
          },
          {
            kind: "PAYMENT",
            documentGroup: options.deterministicGroup,
            label: "Pagamento",
            amount: "28.00",
            date: "2026-05-27",
            page: 20,
            text: "Pagamento R$ 28,00",
          },
        ],
      },
      {
        lineNumber: 20,
        description: "Comprovante localizado pela auditoria",
        documentGroup: options.aiGroup,
        documentRole: "SUPPORTING_DOCUMENT",
        countsTowardDocumentTotal: false,
        quantity: null,
        unitPrice: null,
        totalAmount: null,
        evidenceObservations: [],
      },
    ],
  };
  const aiDiscovery: AiDiscoveryResponse = {
    findings: [
      {
        actualValue: options.formattedAiValues ? "R$ 28,00" : "28.00",
        category: "AMOUNTS",
        code: "AI_PAYMENT_DIFFERENCE",
        confidence: 0.99,
        description: "O pagamento diverge da despesa registrada.",
        evidence: {
          field: "valor",
          lineNumber: options.aiLineNumber === undefined ? 20 : options.aiLineNumber,
          page: 20,
          source: "Comprovante de pagamento",
          summary: "O cartão registra R$ 28,00 para a despesa de R$ 18,00.",
        },
        expectedValue: options.formattedAiValues ? "R$ 18,00" : "18.00",
        justification: "Os valores estão no mesmo conjunto documental.",
        noteItemLineNumber:
          options.aiLineNumber === undefined ? 20 : options.aiLineNumber,
        references: ["DOCUMENTO:página:20:PAYMENT"],
        severity: "WARNING",
        source: "AI_DISCOVERY",
        title: "Pagamento diverge da despesa",
      },
    ],
    coverage: {
      checkedAreas: ["AMOUNTS"],
      limitations: [],
      sufficientEvidence: true,
    },
    contextQuestions: [],
    needsContext: false,
    summary: "Valores auditados.",
  };

  return evaluateHarness({ aiDiscovery, invoice }).findings.filter((finding) => {
    const expected = String(finding.expectedValue ?? "").replace(/\D/g, "");
    const actual = String(finding.actualValue ?? "").replace(/\D/g, "");
    return expected === "1800" && actual === "2800";
  });
}

test("deduplica a mesma divergência quando ficha e pagamento usam linhas distintas", () => {
  assert.equal(
    reimbursementWithAiAmountFinding({
      aiGroup: "evento-casa-da-uva",
      deterministicGroup: "evento-casa-da-uva",
    }).length,
    1,
  );
});

test("preserva achado da IA na mesma página quando pertence a outro evento", () => {
  assert.equal(
    reimbursementWithAiAmountFinding({
      aiGroup: "evento-b",
      deterministicGroup: "evento-a",
    }).length,
    2,
  );
});

test("deduplica valor monetário formatado quando a IA localiza apenas a página", () => {
  assert.equal(
    reimbursementWithAiAmountFinding({
      aiGroup: "evento-casa-da-uva",
      aiLineNumber: null,
      deterministicGroup: "evento-casa-da-uva",
      formattedAiValues: true,
    }).length,
    1,
  );
});

test("deduplica valor monetário em milhar quando a IA omite os centavos", () => {
  const shared = {
    category: "AMOUNTS",
    evidence: {
      documentGroup: "evento-valor-alto",
      field: "valor",
      lineNumber: 1,
      page: 1,
      summary: "Os valores do mesmo evento divergem.",
    },
    noteItemLineNumber: 1,
    references: ["DOCUMENTO:página:1"],
  };

  const findings = deduplicateHarnessFindings([
    {
      ...shared,
      actualValue: "1500.00",
      code: "AMOUNT_MISMATCH_LOCAL",
      expectedValue: "1234.00",
    },
    {
      ...shared,
      actualValue: "R$ 1.500",
      code: "AMOUNT_MISMATCH_AI",
      expectedValue: "R$ 1.234",
    },
  ]);

  assert.equal(findings.length, 1);
});

test("preserva erros aritméticos iguais em linhas distintas do mesmo documento", () => {
  const invoice: HarnessInvoice = {
    documentKind: "FISCAL_INVOICE",
    documentNumber: "SYNTH-TWO-LINES",
    supplierName: "Fornecedor sintético",
    supplierTaxId: null,
    issuedAt: "2026-08-22",
    totalAmount: "56.00",
    readConfidence: 0.99,
    warnings: [],
    markdown: "Nota fiscal sintética com duas linhas independentes.",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 2,
      firstLineNumber: 1,
      lastLineNumber: 2,
      missingLineNumbers: [],
      evidence: "Duas linhas conferidas.",
    },
    items: [1, 2].map((lineNumber) => ({
      lineNumber,
      description: `Produto ${lineNumber}`,
      documentGroup: "nf-sintetica",
      documentRole: "LINE_ITEM" as const,
      countsTowardDocumentTotal: true,
      arithmeticVerified: true,
      quantity: "1",
      unitPrice: "18.00",
      totalAmount: "28.00",
      evidenceObservations: [],
    })),
  };

  const arithmeticFindings = evaluateHarness({ invoice }).findings.filter(
    (finding) => finding.code === "ITEM_ARITHMETIC_MISMATCH",
  );
  assert.equal(arithmeticFindings.length, 2);
  assert.deepEqual(
    arithmeticFindings.map((finding) => finding.noteItemLineNumber),
    [1, 2],
  );
});

test("preserva descobertas distintas quando a mesma página contém grupos ambíguos", () => {
  const invoice: HarnessInvoice = {
    ...sparseInvoice,
    documentKind: "COMPOSITE",
    documentNumber: "SYNTH-AMBIGUOUS-PAGE",
    readConfidence: 0.99,
    markdown: "Documento composto com dois eventos na mesma página.",
    totalAmount: "56.00",
    itemCoverage: {
      status: "COMPLETE",
      declaredItemCount: 2,
      extractedItemCount: 2,
      firstLineNumber: 1,
      lastLineNumber: 2,
      missingLineNumbers: [],
      evidence: "Dois eventos conferidos.",
    },
    items: ["evento-a", "evento-b"].map((documentGroup, index) => ({
      lineNumber: index + 1,
      description: `Evento ${index + 1}`,
      documentGroup,
      documentRole: "LINE_ITEM" as const,
      countsTowardDocumentTotal: true,
      quantity: "1",
      unitPrice: "28.00",
      totalAmount: "28.00",
      evidenceObservations: [
        {
          kind: "RECEIPT" as const,
          documentGroup,
          label: `Recibo ${index + 1}`,
          amount: "28.00",
          date: "2026-08-22",
          page: 20,
          text: `Evento ${index + 1} na página compartilhada`,
        },
      ],
    })),
  };
  const aiDiscovery: AiDiscoveryResponse = {
    findings: ["A", "B"].map((suffix) => ({
      actualValue: "28.00",
      category: "AMOUNTS",
      code: `AI_EVENT_${suffix}`,
      confidence: 0.99,
      description: `Divergência independente ${suffix}.`,
      evidence: {
        field: "valor",
        lineNumber: null,
        page: 20,
        source: `Trecho ${suffix}`,
        summary: `Evidência independente ${suffix} na página compartilhada.`,
      },
      expectedValue: "18.00",
      justification: `O evento ${suffix} contém valores conflitantes.`,
      noteItemLineNumber: null,
      references: [`DOCUMENTO:página:20:EVENTO_${suffix}`],
      severity: "WARNING" as const,
      source: "AI_DISCOVERY" as const,
      title: `Divergência ${suffix}`,
    })),
    coverage: {
      checkedAreas: ["AMOUNTS"],
      limitations: [],
      sufficientEvidence: true,
    },
    contextQuestions: [],
    needsContext: false,
    summary: "Dois eventos distintos avaliados.",
  };

  assert.equal(
    evaluateHarness({ aiDiscovery, invoice }).findings.filter((finding) =>
      finding.code.startsWith("AI_EVENT_"),
    ).length,
    2,
  );
});

test("preserva divergências iguais quando pertencem a eventos distintos", () => {
  const findings = deduplicateHarnessFindings(
    ["evento-a", "evento-b"].map((documentGroup, index) => ({
      actualValue: "28.00",
      category: "AMOUNTS",
      code: `EVIDENCE_AMOUNT_MISMATCH_${index + 1}`,
      evidence: {
        documentGroup,
        lineNumber: index + 1,
        pages: [1, 2],
        summary: "Ficha e pagamento divergem.",
      },
      expectedValue: "18.00",
      noteItemLineNumber: index + 1,
      references: ["DOCUMENTO:página:1:SHEET", "DOCUMENTO:página:2:PAYMENT"],
    })),
  );

  assert.equal(findings.length, 2);
});

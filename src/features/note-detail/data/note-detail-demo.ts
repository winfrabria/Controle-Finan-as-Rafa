import type {
  LoadNoteDetailInput,
  NoteDetailBase,
  NoteDetailData,
} from "./note-detail-contract";
import {
  FindingSeverity,
  FindingStatus,
  NoteClassification,
  NoteStatus,
  ProcessingStage,
} from "@/generated/prisma/enums";
import { sanitizeReviewerJson } from "./reviewer-data-policy";

export const DEMO_NOTE_ID_PATTERN = /^demo-[a-z0-9][a-z0-9-]{0,80}$/i;

export function createDemoNoteDetail({
  id,
  role,
}: LoadNoteDetailInput): NoteDetailData {
  const receivedAt = new Date("2026-07-10T11:30:00.000Z");
  const extractedAt = new Date("2026-07-10T11:30:35.000Z");
  const processedAt = new Date("2026-07-10T11:31:12.000Z");
  const pendingAt = new Date("2026-07-10T11:31:20.000Z");
  const queueMatch = id.match(/^demo-validation-(\d+)$/i);
  const noteNumber = queueMatch
    ? String(12590 - Number(queueMatch[1])).padStart(8, "0")
    : id.replace(/^demo-/, "") || "00012589";
  const items: NoteDetailBase["items"] = [
    {
      code: "000123",
      description: "CIMENTO CP IV 32 - SACO 50KG",
      id: `${id}-item-1`,
      lineNumber: 1,
      quantity: "200.0000",
      rawData: { unidade: "SC", origem: "DANFE linha 1" },
      totalAmount: "5700.00",
      unit: "SC",
      unitPrice: "28.5000",
    },
    {
      code: "000124",
      description: "AREIA MÉDIA LAVADA",
      id: `${id}-item-2`,
      lineNumber: 2,
      quantity: "120.0000",
      rawData: { unidade: "M3", origem: "DANFE linha 2" },
      totalAmount: "10500.00",
      unit: "M3",
      unitPrice: "87.5000",
    },
    {
      code: "000125",
      description: "BRITA 1",
      id: `${id}-item-3`,
      lineNumber: 3,
      quantity: "100.0000",
      rawData: { unidade: "M3", origem: "DANFE linha 3" },
      totalAmount: "9500.00",
      unit: "M3",
      unitPrice: "95.0000",
    },
    {
      code: "000126",
      description: "VERGALHÃO CA-50 10MM",
      id: `${id}-item-4`,
      lineNumber: 4,
      quantity: "1000.0000",
      rawData: { unidade: "KG", origem: "DANFE linha 4" },
      totalAmount: "11000.00",
      unit: "KG",
      unitPrice: "11.0000",
    },
    {
      code: "000127",
      description: "VERGALHÃO CA-50 12,5MM",
      id: `${id}-item-5`,
      lineNumber: 5,
      quantity: "800.0000",
      rawData: { unidade: "KG", origem: "DANFE linha 5" },
      totalAmount: "12480.00",
      unit: "KG",
      unitPrice: "15.6000",
    },
  ];
  const source = {
    kind: "document" as const,
    label: "Nota fiscal original enviada",
    url: null,
  };
  const contractSource = {
    kind: "reference" as const,
    label: "Contrato vigente da Obra Piloto HWN",
    url: null,
  };
  const measurementSource = {
    kind: "reference" as const,
    label: "Medição acumulada da Obra Piloto HWN",
    url: null,
  };
  const priceSource = {
    kind: "reference" as const,
    label: "Tabela de preços de referência cadastrada",
    url: null,
  };
  const findings: NoteDetailBase["analysis"]["findings"] = [
    {
      actualValue: { item: "BRITA 1", previstoNoContrato: false },
      affectedItem: {
        code: items[2].code,
        description: items[2].description,
        id: items[2].id,
        lineNumber: items[2].lineNumber,
      },
      category: "CONTRATO",
      code: "ITEM_FORA_CONTRATO",
      createdAt: processedAt,
      description:
        "O item BRITA 1 não consta na relação vigente de materiais da obra.",
      evidence: {
        itemNota: "BRITA 1",
        referencia: "Contrato vigente da Obra Piloto HWN",
        secaoDocumento: "Itens previstos para fundação e estrutura",
      },
      expectedValue: { itemEsperadoNoContrato: true },
      id: `${id}-finding-1`,
      needsValidation: true,
      rule: {
        code: "CONTRATO_ITEM_001",
        description: "Compara os itens da nota com o contrato ativo da obra.",
        id: `${id}-rule-1`,
        name: "Item previsto no contrato",
      },
      severity: FindingSeverity.CRITICAL,
      sources: [source, contractSource],
      status: FindingStatus.OPEN,
      title: "Item não previsto no contrato",
      updatedAt: processedAt,
    },
    {
      actualValue: {
        excedentePercentual: 35,
        quantidadeNaNota: 200,
        unidade: "SC",
      },
      affectedItem: {
        code: items[0].code,
        description: items[0].description,
        id: items[0].id,
        lineNumber: items[0].lineNumber,
      },
      category: "QUANTIDADE",
      code: "QUANTIDADE_ACIMA_EXECUTADO",
      createdAt: processedAt,
      description:
        "O item CIMENTO CP IV 32 - SACO 50KG apresenta quantidade 35% acima do executado acumulado.",
      evidence: {
        itemNota: "CIMENTO CP IV 32 - SACO 50KG",
        quantidadeMedidaAcumulada: 148.15,
        quantidadeNota: 200,
        referencia: "Medição acumulada da Obra Piloto HWN",
      },
      expectedValue: {
        quantidadeMaximaConformeMedicao: 148.15,
        unidade: "SC",
      },
      id: `${id}-finding-2`,
      needsValidation: true,
      rule: {
        code: "MEDICAO_QUANTIDADE_001",
        description:
          "Compara a quantidade faturada com o executado acumulado aprovado.",
        id: `${id}-rule-2`,
        name: "Quantidade compatível com a medição",
      },
      severity: FindingSeverity.CRITICAL,
      sources: [source, measurementSource],
      status: FindingStatus.OPEN,
      title: "Quantidade acima do executado",
      updatedAt: processedAt,
    },
    {
      actualValue: {
        diferencaPercentual: 12,
        precoUnitarioNota: 15.6,
        unidade: "KG",
      },
      affectedItem: {
        code: items[4].code,
        description: items[4].description,
        id: items[4].id,
        lineNumber: items[4].lineNumber,
      },
      category: "PRECO",
      code: "PRECO_ACIMA_REFERENCIA",
      createdAt: processedAt,
      description:
        "O item VERGALHÃO CA-50 12,5MM possui preço unitário 12% acima da referência cadastrada.",
      evidence: {
        itemNota: "VERGALHÃO CA-50 12,5MM",
        precoReferencia: 13.93,
        precoUnitarioNota: 15.6,
        referencia: "Tabela de preços de referência cadastrada",
      },
      expectedValue: {
        precoUnitarioMaximo: 13.93,
        unidade: "KG",
      },
      id: `${id}-finding-3`,
      needsValidation: true,
      rule: {
        code: "PRECO_REFERENCIA_001",
        description:
          "Compara o preço unitário da nota com a referência vigente da obra.",
        id: `${id}-rule-3`,
        name: "Preço dentro da referência",
      },
      severity: FindingSeverity.WARNING,
      sources: [source, priceSource],
      status: FindingStatus.OPEN,
      title: "Preço acima da referência",
      updatedAt: processedAt,
    },
  ];
  const base: NoteDetailBase = {
    analysis: {
      classification: NoteClassification.SUSPICIOUS,
      extractionMarkdown:
        "Nota fiscal extraída com fornecedor, valores e cinco itens legíveis. A análise identificou item fora do contrato, quantidade acima do executado e preço acima da referência.",
      findings,
      rawExtraction: {
        baseCalculoIcms: "150000.00",
        currency: "BRL",
        documentNumber: noteNumber,
        inscricaoEstadual: "123.456.789.112",
        items: items.map((item) => ({
          code: item.code,
          description: item.description,
          lineNumber: item.lineNumber,
          quantity: item.quantity,
          totalAmount: item.totalAmount,
          unit: item.unit,
          unitPrice: item.unitPrice,
        })),
        readConfidence: 0.96,
        recipientTaxId: "09.876.543/0001-21",
        serie: "001",
        supplierName: "Construluz Materiais",
        tipoOperacao: "Venda de mercadoria",
        naturezaOperacao: "Venda de mercadoria",
        productsTotal: "125450.00",
        valorIcms: "27000.00",
        warnings: [],
      },
      sources: [source, contractSource, measurementSource, priceSource],
      warnings: [],
    },
    createdAt: receivedAt,
    demoLabel: "Dados de demonstração",
    document: {
      fileName: `DANFE-${noteNumber}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: "1482000",
      storagePath: `demo/${noteNumber}.pdf`,
    },
    failure: { code: null, message: null },
    history: [
      {
        actor: null,
        createdAt: receivedAt,
        data: { origem: "upload público" },
        fromStatus: null,
        id: `${id}-event-1`,
        kind: "event",
        label: "Nota capturada",
        toStatus: NoteStatus.RECEIVED,
        type: "NOTE_CAPTURED",
      },
      {
        actor: null,
        createdAt: extractedAt,
        data: { itensExtraidos: 5 },
        fromStatus: NoteStatus.RECEIVED,
        id: `${id}-event-2`,
        kind: "event",
        label: "Extração concluída",
        toStatus: NoteStatus.PROCESSING,
        type: "EXTRACTION_COMPLETED",
      },
      {
        actor: null,
        createdAt: processedAt,
        data: { achados: 3, classificacao: "SUSPICIOUS" },
        fromStatus: NoteStatus.PROCESSING,
        id: `${id}-event-3`,
        kind: "event",
        label: "Análise da IA concluída",
        toStatus: NoteStatus.PENDING_VALIDATION,
        type: "AI_ANALYSIS_COMPLETED",
      },
      {
        actor: null,
        createdAt: pendingAt,
        data: { aguardandoDecisaoHumana: true },
        fromStatus: NoteStatus.PENDING_VALIDATION,
        id: `${id}-event-4`,
        kind: "event",
        label: "Em análise",
        toStatus: NoteStatus.PENDING_VALIDATION,
        type: "VALIDATION_PENDING",
      },
    ],
    id,
    isDemo: true,
    issuedAt: new Date("2026-07-09T00:00:00.000Z"),
    items,
    number: noteNumber,
    processedAt,
    processingStage: ProcessingStage.COMPLETED,
    receivedAt,
    status: NoteStatus.PENDING_VALIDATION,
    submittedBy: null,
    supplier: {
      name: "Construluz Materiais",
      taxId: "01.234.567/0001-99",
    },
    totalAmount: "125430.00",
    updatedAt: pendingAt,
    validations: [],
    version: 1,
    work: {
      active: true,
      code: "OBRA-PILOTO",
      id: "10000000-0000-4000-8000-000000000001",
      location: "Alphaville, São Paulo - SP",
      name: "Obra Piloto HWN",
    },
  };

  if (role === "ADMIN") {
    return {
      ...base,
      analysis: { ...base.analysis, readConfidence: 0.96 },
      viewerRole: "ADMIN",
    };
  }

  return {
    ...base,
    analysis: {
      ...base.analysis,
      rawExtraction: sanitizeReviewerJson(base.analysis.rawExtraction),
    },
    viewerRole: "REVIEWER",
  };
}

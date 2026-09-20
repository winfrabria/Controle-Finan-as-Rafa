import assert from "node:assert/strict";
import test from "node:test";
import { aiDiscoveryFindingSchema, AI_DISCOVERY_JSON_SCHEMA } from "./contracts";
import { explicitlyConfirmedVerificationFindings, requiresIndependentAiConfirmation, verificationFindingSchema,
  VERIFICATION_JSON_SCHEMA, validateVerificationCoverage, type VerificationResponse } from "./verification";
import { hasTracedHypothesisPair, hasUntracedFindingSourceValue, matchingFindingSourceClaims } from "./finding-source-observations";
import { deduplicateHarnessFindings, evaluateHarness, filterAiDiscoveryFindings } from "./engine";
import { invoiceExtractionSchema } from "@/lib/integrations/openrouter/extraction-contract";

function initial() {
  return aiDiscoveryFindingSchema.parse({ code: "PRODUCT_ATTRIBUTE_CONFLICT", category: "PRODUCT", severity: "WARNING",
    source: "AI_DISCOVERY", confidence: 0.9, title: "Especificações diferentes entre fontes",
    description: "As fontes vinculadas ao fornecimento descrevem tipos distintos.", justification: "Comparação documental pendente de confirmação independente.",
    references: ["Página 1", "Página 2"], comparisonMode: "CONFLICT", referenceBasis: null,
    expectedValue: null, actualValue: "Tipo A e Tipo B", noteItemLineNumber: 1,
    evidence: { field: "especificação", page: 1, lineNumber: 1, source: "Nota fiscal e controle",
      summary: "Dois tipos diferentes no mesmo fornecimento.", observations: [
        { kind: "FISCAL_LINE", label: "Nota fiscal", page: 1, text: "Fornecimento: Cabo Tipo A", value: "Tipo A" },
        { kind: "SHEET", label: "Controle", page: 2, text: "Fornecimento: Cabo Tipo B", value: "Tipo B" },
      ] },
  });
}

function confirmed() {
  const finding = initial();
  return verificationFindingSchema.parse({ ...finding, source: "AI_VERIFICATION", confirmsInitialFindingCode: finding.code });
}

test("contratos da IA preservam duas fontes e conflito sem eleger referência correta", () => {
  const finding = initial(); const verification = confirmed();
  assert.equal(finding.evidence.observations?.length, 2); assert.equal(verification.evidence.observations?.length, 2);
  for (const schema of [AI_DISCOVERY_JSON_SCHEMA, VERIFICATION_JSON_SCHEMA]) {
    const definition = schema.properties.findings.items;
    assert.ok(definition.required.includes("comparisonMode"));
    assert.ok(definition.properties.evidence.required.includes("observations"));
  }
  assert.equal(finding.expectedValue, null); assert.equal(verification.referenceBasis, null);
});

test("conflito de atributo também exige segunda leitura; o código não precisa conter valor ou data", () => {
  const finding = initial(); assert.equal(requiresIndependentAiConfirmation(finding), true);
  const invoice = invoiceExtractionSchema.parse({ documentKind: "FISCAL_INVOICE", documentNumber: "SYNTHETIC", totalAmount: "46", readConfidence: 0.99,
    markdown: "Documento sintético legível com uma linha fiscal e fontes identificadas.", items: [{ lineNumber: 1, description: "Cabo", quantity: "10", unitPrice: "4.6", totalAmount: "46" }],
    itemCoverage: { status: "COMPLETE", extractedItemCount: 1, declaredItemCount: 1,
      firstLineNumber: 1, lastLineNumber: 1, missingLineNumbers: [], evidence: "Uma linha" } });
  const discovery = { findings: [finding], needsContext: false, contextQuestions: [], summary: "Conflito de atributo",
    coverage: { sufficientEvidence: true, checkedAreas: ["produto"], limitations: [] } };
  const provisional = evaluateHarness({ invoice, aiDiscovery: discovery });
  assert.notEqual(provisional.classification, "SUSPICIOUS"); assert.equal(provisional.unconfirmedAiFindings.length, 1);
  const verified = evaluateHarness({ invoice, aiDiscovery: discovery, verificationFindings: [confirmed()] });
  assert.equal(verified.classification, "SUSPICIOUS"); assert.equal(verified.unconfirmedAiFindings.length, 0);
  assert.equal(verified.findings[0].source, "AI_VERIFICATION");
});

test("confirmação textual exige o mesmo conjunto de campos, páginas e tipos de fonte", () => {
  assert.equal(explicitlyConfirmedVerificationFindings([initial()], [confirmed()]).length, 1);
  for (const change of ["value", "page", "kind", "quote", "missing"] as const) {
    const candidate = confirmed(); const source = candidate.evidence.observations![1];
    if (change === "value") { source.value = "Tipo C"; source.text = "Cabo Tipo C"; }
    if (change === "page") source.page = 3;
    if (change === "kind") source.kind = "RECEIPT";
    if (change === "quote") source.text = "Cabo sem tipo informado";
    if (change === "missing") candidate.evidence.observations!.pop();
    assert.equal(explicitlyConfirmedVerificationFindings([initial()], [candidate]).length, 0);
  }
  const inverted = confirmed(); inverted.evidence.observations!.reverse();
  assert.equal(explicitlyConfirmedVerificationFindings([initial()], [inverted]).length, 1);
});

test("valor textual precisa estar na citação, sem converter produto em número ou inventar equivalência", () => {
  assert.equal(hasUntracedFindingSourceValue(initial().evidence), false);
  const invalid = initial(); invalid.evidence.observations![0].value = "Tipo C";
  assert.equal(hasUntracedFindingSourceValue(invalid.evidence), true);
  assert.equal(hasUntracedFindingSourceValue({ summary: "Registro legado" }), false);
});

test("lista textual continua rastreável quando a fonte usa separadores diferentes", () => {
  const evidence = { field: "descrição do item", observations: [
    { kind: "FISCAL_LINE", label: "Nota fiscal", page: 1,
      text: "17 PAO FRANCES 106,95 KG TOTAL 1.604,30", value: "PAO FRANCES" },
    { kind: "SHEET", label: "Ficha", page: 2,
      text: "CAFÉ DA MANHÃ R$ 1.498,00 | JANTA R$ 100,00 | SUCO R$ 6,30",
      value: "CAFÉ DA MANHÃ / JANTA / SUCO" },
  ] };
  assert.equal(hasUntracedFindingSourceValue(evidence), false);

  evidence.observations[1].value = "CAFÉ DA MANHÃ / JANTA / SOBREMESA";
  assert.equal(hasUntracedFindingSourceValue(evidence), true);
});

test("confirma conflito de especificação com lista textual localizada nas duas páginas", () => {
  const discovery = initial();
  discovery.code = "ITEM_DESCRIPTION_MISMATCH";
  discovery.evidence.field = "descrição do item";
  discovery.evidence.claimScope = "DOCUMENT_CONTENT";
  discovery.evidence.observations = [
    { kind: "FISCAL_LINE", label: "Item faturado na NF-e", page: 1,
      text: "17 PAO FRANCES 106,95 KG TOTAL 1.604,30", value: "PAO FRANCES" },
    { kind: "SHEET", label: "Resumo de despesas na planilha", page: 2,
      text: "CAFÉ DA MANHÃ R$ 1.498,00 | JANTA R$ 100,00 | SUCO R$ 6,30",
      value: "CAFÉ DA MANHÃ / JANTA / SUCO" },
  ];
  const verification = verificationFindingSchema.parse({
    ...discovery,
    source: "AI_VERIFICATION",
    confirmsInitialFindingCode: discovery.code,
  });
  const quotes = discovery.evidence.observations.map((source) => ({
    page: source.page,
    quote: source.text,
  }));

  assert.equal(hasTracedHypothesisPair(discovery.evidence, quotes, 0, 1, true), true);
  assert.equal(explicitlyConfirmedVerificationFindings([discovery], [verification]).length, 1);
});

test("valor monetário canônico corresponde ao mesmo valor brasileiro na fonte, sem arredondar", () => {
  const evidence = { field: "totalAmount", observations: [
    { kind: "SALE", label: "Venda", page: 2, text: "Total R$ 72,35", value: "72.35" },
    { kind: "PAYMENT", label: "Pagamento", page: 2, text: "Débito R$ 70,00", value: "70.00" },
  ] };
  assert.equal(hasUntracedFindingSourceValue(evidence), false);
  const verified = structuredClone(evidence);verified.observations[0].value = "R$ 72,35";
  assert.equal(matchingFindingSourceClaims(evidence, verified), true);
  for (const text of ["Total R$ 72,34", "Código X72.35Y", "Data 01/07/2035", "Total R$ 172,35"]) {
    const wrong = structuredClone(evidence);wrong.observations[0].text = text;
    assert.equal(hasUntracedFindingSourceValue(wrong), true);
  }
  const product = { ...evidence, field: "produto" };
  assert.equal(hasUntracedFindingSourceValue(product), true);
});

test("campo financeiro descritivo preserva equivalência monetária e permite fonte corroborante", () => {
  const evidence = { field: "Valor da despesa 12", observations: [
    { kind: "SALE", label: "Venda", page: 13, text: "TOTAL R$ 44,50", value: "44.50" },
    { kind: "PAYMENT", label: "Pagamento", page: 13, text: "VALOR R$ 40,00", value: "40.00" },
  ] };
  assert.equal(hasUntracedFindingSourceValue(evidence), false);
  const verified = structuredClone(evidence);
  verified.observations[0].value = "R$ 44,50";
  verified.observations.push({ kind: "SHEET", label: "Ficha", page: 1, text: "Despesa 12 R$ 40,00", value: "40,00" });
  assert.equal(matchingFindingSourceClaims(evidence, verified), true);
  verified.observations.push({ kind: "RECEIPT", label: "Outra fonte", page: 14, text: "Total R$ 45,00", value: "45.00" });
  assert.equal(matchingFindingSourceClaims(evidence, verified), false);
});

test("hipótese de campos vazios usa trechos textuais localizados sem inventar valor", () => {
  const evidence = { field: "campos obrigatórios", observations: [
    { kind: "SHEET", label: "Finalidade", page: 1, text: "Finalidade: campo vazio", value: null },
    { kind: "SHEET", label: "Assinatura", page: 1, text: "Assinatura: campo vazio", value: null },
  ] };
  const quotes = [{ page: 1, quote: "Finalidade: campo vazio" }, { page: 1, quote: "Assinatura: campo vazio" }];
  assert.equal(hasTracedHypothesisPair(evidence, quotes, 0, 1, true), true);
  quotes[1].quote = "Campo diverso";
  assert.equal(hasTracedHypothesisPair(evidence, quotes, 0, 1, true), false);
});

test("data ISO e brasileira equivalentes mantêm página e fonte, sem adivinhar século", () => {
  const evidence = { field: "sourceDate", observations: [
    { kind: "SHEET", label: "Controle", page: 1, text: "Controle 08/06/2026", value: "2026-06-08" },
    { kind: "RECEIPT", label: "Recibo", page: 2, text: "Recibo 07/06/2026", value: "2026-06-07" },
  ] };
  assert.equal(hasUntracedFindingSourceValue(evidence), false);
  const verified = structuredClone(evidence);verified.observations[0].value = "08/06/2026";
  assert.equal(matchingFindingSourceClaims(evidence, verified), true);
  verified.observations[0].page = 3;
  assert.equal(matchingFindingSourceClaims(evidence, verified), false);
  evidence.observations[0].text = "Controle 08/06/26";
  assert.equal(hasUntracedFindingSourceValue(evidence), true);
});

test("cobertura rejeita página secundária inexistente e valor sem trecho correspondente", () => {
  const finding = confirmed(); finding.confirmsInitialFindingCode = null;
  const response: VerificationResponse = { status: "FINDINGS", findings: [finding], checks: [], limitations: [], summary: "Sintético",
    pageCoverage: { status: "COMPLETE", expectedPageCount: 2, checkedPages: [1, 2], missingPages: [] } };
  finding.evidence.observations![1].page = 99;
  let coverage = validateVerificationCoverage({ response, expectedChecks: [], expectedPageCount: 2 });
  assert.deepEqual(coverage.invalidFindingPages, [finding.code]); assert.equal(coverage.complete, false);
  finding.evidence.observations![1].page = 2; finding.evidence.observations![1].value = "Outro valor";
  coverage = validateVerificationCoverage({ response, expectedChecks: [], expectedPageCount: 2 });
  assert.deepEqual(coverage.invalidFindingEvidenceCodes, [finding.code]); assert.equal(coverage.complete, false);
});

test("registros anteriores continuam legíveis sem receber fontes artificiais", () => {
  const discovery = initial(); delete discovery.evidence.observations;
  const verification = confirmed(); delete verification.evidence.observations; delete verification.comparisonMode; delete verification.referenceBasis;
  assert.ok(aiDiscoveryFindingSchema.safeParse(discovery).success);
  assert.ok(verificationFindingSchema.safeParse(verification).success);
});

test("palavra veículo no trecho não apaga um conflito intrínseco de produto", () => {
  const finding = initial();
  finding.evidence.observations![1].text = "Controle do veículo, fornecedor anotado: Cabo Tipo B";
  finding.description = "Produto divergente entre nota e controle do veículo.";
  assert.equal(filterAiDiscoveryFindings([finding]).length, 1);
  assert.equal(requiresIndependentAiConfirmation(finding), true);
  finding.evidence.field = "placa"; finding.category = "ASSET_ASSOCIATION";
  assert.equal(filterAiDiscoveryFindings([finding]).length, 0);
  finding.evidence.field = "fornecedor"; finding.category = "SUPPLIER_NAME";
  finding.description = "Fornecedor com nome divergente.";
  assert.equal(filterAiDiscoveryFindings([finding]).length, 0);
});

test("escopo documental explícito não depende de um nome exato para o campo", () => {
  for (const field of ["tipo de combustível", "especificação do material", "unidade de fornecimento", "serviço executado"]) {
    const finding = initial();
    finding.evidence.observations![1].text = "Controle do veículo: Cabo Tipo B";
    const scoped = { ...finding, evidence: { ...finding.evidence, field, claimScope: "DOCUMENT_CONTENT" } };
    assert.equal(filterAiDiscoveryFindings([scoped]).length, 1, field);
    assert.equal(requiresIndependentAiConfirmation(scoped), true);
  }
});

test("escopo de autorização não usa campo produto como atalho para dispensar regra da obra", () => {
  const finding = initial();
  finding.description = "Produto fornecido ao veículo sem autorização da obra.";
  const scoped = { ...finding, evidence: { ...finding.evidence, field: "produto", claimScope: "WORK_AUTHORIZATION" } };
  assert.equal(filterAiDiscoveryFindings([scoped]).length, 0);
});

test("escopo tipado é preservado nos dois contratos e continua ausente no legado", () => {
  for (const scope of ["DOCUMENT_CONTENT", "ENTITY_IDENTITY", "WORK_AUTHORIZATION", "OTHER", null] as const) {
    const discovery = initial(); discovery.evidence.claimScope = scope;
    const verification = confirmed(); verification.evidence.claimScope = scope;
    assert.equal(aiDiscoveryFindingSchema.parse(discovery).evidence.claimScope, scope);
    assert.equal(verificationFindingSchema.parse(verification).evidence.claimScope, scope);
  }
  for (const schema of [AI_DISCOVERY_JSON_SCHEMA, VERIFICATION_JSON_SCHEMA]) {
    const evidence = schema.properties.findings.items.properties.evidence;
    assert.ok(evidence.required.includes("claimScope"));
    assert.deepEqual(evidence.properties.claimScope.enum, ["DOCUMENT_CONTENT", "ENTITY_IDENTITY", "WORK_AUTHORIZATION", "OTHER", null]);
  }
  assert.equal("claimScope" in aiDiscoveryFindingSchema.parse(initial()).evidence, false);
  assert.equal("claimScope" in verificationFindingSchema.parse(confirmed()).evidence, false);
  for (const scope of ["DOCUMENT", true, {}, "IGNORE_RULES"]) {
    const candidate = { ...initial(), evidence: { ...initial().evidence, claimScope: scope } };
    assert.equal(aiDiscoveryFindingSchema.safeParse(candidate).success, false);
    assert.equal(verificationFindingSchema.safeParse({ ...candidate, source: "AI_VERIFICATION" }).success, false);
  }
});

test("mesmos valores e fontes não confirmam um escopo diferente ou omitido", () => {
  const discovery = initial(); discovery.evidence.claimScope = "DOCUMENT_CONTENT";
  const verification = confirmed(); verification.evidence.claimScope = "DOCUMENT_CONTENT";
  assert.equal(explicitlyConfirmedVerificationFindings([discovery], [verification]).length, 1);
  for (const scope of ["ENTITY_IDENTITY", "WORK_AUTHORIZATION", "OTHER", null, undefined] as const) {
    verification.evidence.claimScope = scope;
    assert.equal(explicitlyConfirmedVerificationFindings([discovery], [verification]).length, 0);
  }
  verification.evidence.claimScope = null;
  assert.equal(explicitlyConfirmedVerificationFindings([initial()], [verification]).length, 1);
});

test("escopo documental não dispensa trechos, campos de identidade ou autorização explícitos", () => {
  const finding = initial(); finding.evidence.claimScope = "DOCUMENT_CONTENT";
  finding.description = "Produto divergente no controle do veículo.";
  const missing = structuredClone(finding); missing.evidence.observations = [];
  const untraced = structuredClone(finding); untraced.evidence.observations![1].text = "Controle sem tipo identificado";
  assert.equal(filterAiDiscoveryFindings([missing, untraced]).length, 0);
  for (const field of ["placa", "autorização do veículo", "CNPJ do fornecedor", "beneficiário"]) {
    const restricted = structuredClone(finding); restricted.evidence.field = field;
    assert.equal(filterAiDiscoveryFindings([restricted]).length, 0, field);
  }
});

test("identidade explícita exige dois identificadores mesmo com campo genérico", () => {
  const finding = initial(); finding.evidence.field = "item"; finding.evidence.claimScope = "ENTITY_IDENTITY";
  assert.equal(filterAiDiscoveryFindings([finding]).length, 0);
  finding.evidence.observations = [
    { kind: "FISCAL_LINE", label: "A", page: 1, text: "CNPJ 12.345.678/0001-90", value: "12.345.678/0001-90" },
    { kind: "SHEET", label: "B", page: 2, text: "CNPJ 98.765.432/0001-10", value: "98.765.432/0001-10" },
  ];
  assert.equal(filterAiDiscoveryFindings([finding]).length, 1);
  assert.equal(requiresIndependentAiConfirmation(finding), true);
});

test("autorização exige código exato de uma regra fornecida, não uma regra incidental", () => {
  const finding = initial(); finding.evidence.field = "produto"; finding.evidence.claimScope = "WORK_AUTHORIZATION";
  finding.description = "Produto destinado ao veículo não autorizado.";
  const rule = { code: "AUTHORIZED_ASSETS", name: "Veículos autorizados", category: "ASSET", severity: "WARNING" as const,
    configuration: { allowed: ["SYNTHETIC"] } };
  assert.equal(filterAiDiscoveryFindings([finding], [rule]).length, 0);
  finding.references.push("Inventei AUTHORIZED_ASSETS como referência");
  assert.equal(filterAiDiscoveryFindings([finding], [rule]).length, 0);
  finding.references.push(rule.code);
  assert.equal(filterAiDiscoveryFindings([finding], [rule]).length, 1);
  assert.equal(requiresIndependentAiConfirmation(finding), true);
  assert.equal(filterAiDiscoveryFindings([finding], [{ ...rule, code: "OTHER_POLICY" }]).length, 0);
});

test("desduplicação não mistura conflito documental com autorização usando os mesmos valores", () => {
  const finding = initial(); finding.evidence.claimScope = "DOCUMENT_CONTENT";
  const other = structuredClone(finding); other.evidence.claimScope = "WORK_AUTHORIZATION";
  assert.equal(deduplicateHarnessFindings([finding, other, structuredClone(finding)]).length, 2);
});

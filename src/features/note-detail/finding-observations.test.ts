import assert from "node:assert/strict";
import test from "node:test";
import { findingEvidenceLocationSummary, extractFindingComparisonValues, extractFindingEvidenceObservations,
  findingObservationKindLabel, summarizeFindingEvidenceObservations } from "./finding-observations";
import { reviewerObservationValue } from "@/features/internal-notes/finding-display";

test("localização resume todas as páginas distintas, não só a primeira fonte", () => {
  assert.equal(findingEvidenceLocationSummary([{ page: 13 }, { page: 1 }, { page: 13 }]), "Páginas 1, 13 · 3 trechos");
  assert.equal(findingEvidenceLocationSummary([{ page: 2 }]), "Página 2 · 1 trecho");
  assert.equal(findingEvidenceLocationSummary([{ page: null }]), "Localização não informada · 1 trecho");
  assert.equal(findingEvidenceLocationSummary([]), "Abrir evidências do achado");
});

test("produto e atributo preservam valores textuais e páginas separadas no card", () => {
  const evidence = { field: "produto", observations: [
    { kind: "FISCAL_LINE", label: "Nota fiscal", page: 1, text: "Cabo Tipo A", value: "Tipo A" },
    { kind: "SHEET", label: "Controle", page: 2, text: "Cabo Tipo B", value: "Tipo B" },
  ] };
  assert.deepEqual(extractFindingComparisonValues(evidence), [{ label: "Nota fiscal", value: "Tipo A" }, { label: "Controle", value: "Tipo B" }]);
  const sources = extractFindingEvidenceObservations(evidence);
  assert.equal(findingObservationKindLabel(sources[0].kind), "Nota fiscal");
  assert.equal(reviewerObservationValue(sources[0], { field: "produto" }), "Tipo A");
  assert.equal(sources[0].amount, null); assert.equal(sources[0].page, 1); assert.equal(sources[1].page, 2);
});

test("valores diferentes de fontes com rótulo igual não desaparecem em resumo agregado", () => {
  const sources = extractFindingEvidenceObservations({ observations: [
    { kind: "SHEET", label: "Controle", page: 1, text: "Tipo A", value: "Tipo A" },
    { kind: "SHEET", label: "Controle", page: 1, text: "Tipo B", value: "Tipo B" },
  ] });
  assert.equal(summarizeFindingEvidenceObservations(sources).length, 2);
});

test("card preserva mais de vinte valores de comparação sem corte silencioso", () => {
  const observations = Array.from({ length: 25 }, (_, index) => ({
    label: `Fonte ${index + 1}`, value: index + 1,
  }));
  const values = extractFindingComparisonValues({ observations });
  assert.equal(values.length, 25);
  assert.deepEqual(values.at(-1), { label: "Fonte 25", value: 25 });
});

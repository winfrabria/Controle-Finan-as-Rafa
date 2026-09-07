import assert from "node:assert/strict";
import test from "node:test";

import { extractReviewerEvidenceFields } from "./reviewer-evidence-fields";

test("resume e expande campos obrigatórios sem expor metadados", () => {
  const longExcerpt = "Trecho do documento ".repeat(20);
  const evidence = {
    fields: [
      {
        boundingBox: { height: 4, width: 3, x: 1, y: 2 },
        evidence: "Trecho do aprovador na página inicial.",
        field: "Aprovador",
        id: "field-1",
        page: null,
        requirementBasis: "EXPLICIT_DOCUMENT",
      },
      {
        evidence: "Motivo registrado no documento.",
        fieldName: "Motivo",
        page: "2",
        requirementEvidence: "Não deve substituir o trecho principal.",
      },
      { field: "Ficha", page: -1, text: "Página inválida." },
      { field: "Assinatura do solicitante", page: 3, text: longExcerpt },
      { field: "Assinatura do financeiro", page: 4, text: "Trecho 5" },
      { field: "Data de aprovação", page: 5, text: "Trecho 6" },
      { field: "Observação", page: 6, text: "Trecho 7" },
    ],
    requirementBasis: "VERIFIED_POLICY",
  };

  const result = extractReviewerEvidenceFields(evidence);

  assert.ok(result);
  assert.equal(result.summary, "7 campos obrigatórios vazios. Exemplos: Aprovador e Motivo.");
  assert.equal(result.expandLabel, "Ver os 7 campos");
  assert.deepEqual(result.fields[0], {
    excerpt: "Trecho do aprovador na página inicial.",
    label: "Aprovador",
    page: null,
  });
  assert.deepEqual(result.fields[1], {
    excerpt: "Motivo registrado no documento.",
    label: "Motivo",
    page: 2,
  });
  assert.equal(result.fields[2]?.page, null);
  assert.equal(result.fields[3]?.excerpt?.endsWith("…"), true);
  assert.ok((result.fields[3]?.excerpt?.length ?? 0) <= 180);
  assert.doesNotMatch(
    JSON.stringify(result),
    /requirementBasis|requirementEvidence|boundingBox|["']id["']\s*:|VERIFIED_POLICY|EXPLICIT_DOCUMENT/i,
  );
});

test("aceita missingFields legado com página e trecho seguros", () => {
  const result = extractReviewerEvidenceFields({
    missingFields: [
      { evidence: "Campo ausente no documento.", label: "CNPJ", page: 1 },
      "Assinatura",
    ],
  });

  assert.deepEqual(result, {
    expandLabel: "Ver os 2 campos",
    fields: [
      { excerpt: "Campo ausente no documento.", label: "CNPJ", page: 1 },
      { excerpt: null, label: "Assinatura", page: null },
    ],
    summary: "2 campos obrigatórios vazios. Exemplos: CNPJ e Assinatura.",
  });
});

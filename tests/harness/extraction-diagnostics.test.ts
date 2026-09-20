import assert from "node:assert/strict";
import test from "node:test";
import { extractionSchemaDiagnostics } from "@/lib/integrations/openrouter/extraction-diagnostics";

test("diagnóstico explica hierarquia inválida sem copiar o conteúdo privado da resposta", () => {
  const details = extractionSchemaDiagnostics([
    { path: ["items"], code: "custom", message: "Invalid document hierarchy: complete-breakdown-without-children." },
    { path: ["items", 2, "totalAmount"], code: "invalid_format", message: "sensitive provider text and values" },
  ]);
  assert.deepEqual(details, { issues: [
    { path: "items", code: "custom", reason: "complete-breakdown-without-children" },
    { path: "items.2.totalAmount", code: "invalid_format" },
  ] });
  assert.doesNotMatch(JSON.stringify(details), /sensitive|values|provider/);
});

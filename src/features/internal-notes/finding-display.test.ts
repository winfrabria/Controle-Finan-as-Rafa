import assert from "node:assert/strict";
import test from "node:test";

import { formatFindingValue } from "./finding-display";

test("formata valores monetários dos achados sem perder a fonte", () => {
  const value = formatFindingValue({
    amount: "18900.00",
    source: "Histórico da Obra 02",
  });

  assert.match(value, /R\$\u00a018\.900,00/);
  assert.match(value, /Fonte: Histórico da Obra 02/);
  assert.equal(formatFindingValue("18900.00"), "R$\u00a018.900,00");
});

test("mostra evidência textual sem expor as chaves do JSON", () => {
  const value = formatFindingValue({
    text: "R$ 18.900,00 contra referência média de R$ 15.500,00.",
  });

  assert.equal(value, "R$ 18.900,00 contra referência média de R$ 15.500,00.");
  assert.doesNotMatch(value, /text|\{|\}/i);
});

test("não trata quantidade ou identificador como moeda", () => {
  const value = formatFindingValue({
    item: "Kit de parafusos",
    quantity: "1500",
  });

  assert.equal(value, "Item: Kit de parafusos · Quantidade: 1500");
  assert.doesNotMatch(value, /R\$/);
});

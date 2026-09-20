import assert from "node:assert/strict";
import test from "node:test";
import { formatDecimal, formatQuantity, formatUnitPrice } from "./note-detail-format";

test("quantidades preservam frações de medição sem arredondar para unidades inteiras", () => {
  assert.equal(formatQuantity("92.8000"), "92,8");
  assert.equal(formatQuantity("1594.6840"), "1.594,684");
  assert.equal(formatQuantity("0.0001"), "0,0001");
  assert.equal(formatQuantity("50.0000"), "50");
  assert.equal(formatQuantity("-12.3456"), "-12,3456");
});

test("quantidade não perde precisão inteira, não inventa zero e normaliza somente a apresentação", () => {
  assert.equal(formatQuantity("9007199254740993.0001"), "9.007.199.254.740.993,0001");
  assert.equal(formatQuantity(null), "—");
  assert.equal(formatQuantity(""), "—");
  assert.equal(formatQuantity("0.0000"), "0");
  assert.equal(formatQuantity("-0.0000"), "0");
  assert.equal(formatQuantity("não legível"), "não legível");
});

test("preço unitário conserva casas significativas; total continua com duas casas", () => {
  assert.equal(formatUnitPrice("7.5300"), "7,53");
  assert.equal(formatUnitPrice("6.5999"), "6,5999");
  assert.equal(formatUnitPrice("25"), "25,00");
  assert.equal(formatUnitPrice("0.0010"), "0,001");
  assert.equal(formatUnitPrice(null), "—");
  assert.equal(formatDecimal("698.78"), "698,78");
});

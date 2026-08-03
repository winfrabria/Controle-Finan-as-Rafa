import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDashboardMoney,
  parseDashboardMoney,
} from "./dashboard-money";

test("converte valores crus do banco sem multiplicar os centavos", () => {
  assert.equal(parseDashboardMoney("551.90"), 551.9);
  assert.equal(parseDashboardMoney("125430.00"), 125430);
});

test("converte valores já formatados em pt-BR", () => {
  assert.equal(parseDashboardMoney("R$ 1.234,56"), 1234.56);
  assert.equal(formatDashboardMoney(551.9), "R$\u00a0551,90");
});

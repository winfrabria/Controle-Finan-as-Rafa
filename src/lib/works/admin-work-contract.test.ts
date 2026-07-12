import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminWorkSchema,
  listAdminWorksQuerySchema,
  updateAdminWorkSchema,
} from "./admin-work-contract";

test("normaliza o código da obra e limpa local vazio", () => {
  const result = createAdminWorkSchema.parse({
    codigo: "  obra-sp_01 ",
    nome: "  Edifício Central ",
    local: "   ",
  });

  assert.deepEqual(result, {
    codigo: "OBRA-SP_01",
    nome: "Edifício Central",
    local: null,
  });
});

test("rejeita edição vazia e código com caracteres inseguros", () => {
  assert.equal(updateAdminWorkSchema.safeParse({}).success, false);
  assert.equal(
    createAdminWorkSchema.safeParse({
      codigo: "obra com espaço",
      nome: "Obra válida",
    }).success,
    false,
  );
});

test("limita paginação e aceita filtros administrativos", () => {
  assert.deepEqual(
    listAdminWorksQuerySchema.parse({
      busca: "centro",
      status: "inativas",
      pagina: "2",
      porPagina: "50",
    }),
    {
      busca: "centro",
      status: "inativas",
      pagina: 2,
      porPagina: 50,
    },
  );
  assert.equal(
    listAdminWorksQuerySchema.safeParse({ porPagina: "101" }).success,
    false,
  );
});

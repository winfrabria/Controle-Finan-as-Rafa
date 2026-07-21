import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminWorkSchema,
  listAdminWorksQuerySchema,
  updateAdminWorkSchema,
} from "./admin-work-contract";

test("normaliza o código, a UF e o responsável da obra", () => {
  const result = createAdminWorkSchema.parse({
    codigo: "  obra-sp_01 ",
    nome: "  Edifício Central ",
    local: " São Paulo - sp ",
    responsavel: "  Carlos Menezes ",
  });

  assert.deepEqual(result, {
    codigo: "OBRA-SP_01",
    nome: "Edifício Central",
    local: "São Paulo - SP",
    responsavel: "Carlos Menezes",
    ativa: true,
  });
});

test("rejeita edição vazia e código com caracteres inseguros", () => {
  assert.equal(updateAdminWorkSchema.safeParse({}).success, false);
  assert.equal(
    createAdminWorkSchema.safeParse({
      codigo: "obra com espaço",
      nome: "Obra válida",
      local: "São Paulo - SP",
      responsavel: "Carlos Menezes",
    }).success,
    false,
  );
});

test("exige responsável em novas obras e permite atualizá-lo", () => {
  assert.equal(
    createAdminWorkSchema.safeParse({
      codigo: "OBR-1",
      nome: "Obra sem responsável",
      local: "São Paulo - SP",
    }).success,
    false,
  );
  assert.equal(
    updateAdminWorkSchema.safeParse({
      responsavel: "Carlos Menezes",
    }).success,
    true,
  );
});

test("normaliza a UF e exige local no formato Cidade - UF", () => {
  const valid = createAdminWorkSchema.parse({
    codigo: "OBR-2",
    nome: "Obra Goiânia",
    local: "Goiânia - go",
    responsavel: "Carlos Menezes",
  });
  assert.equal(valid.local, "Goiânia - GO");
  assert.equal(
    createAdminWorkSchema.safeParse({
      codigo: "OBR-3",
      nome: "Local inválido",
      local: "Goiânia/GO",
      responsavel: "Carlos Menezes",
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

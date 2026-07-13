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
    responsavelId: "00000000-0000-4000-8000-000000000001",
  });

  assert.deepEqual(result, {
    codigo: "OBRA-SP_01",
    nome: "Edifício Central",
    local: null,
    responsavelId: "00000000-0000-4000-8000-000000000001",
    ativa: true,
  });
});

test("rejeita edição vazia e código com caracteres inseguros", () => {
  assert.equal(updateAdminWorkSchema.safeParse({}).success, false);
  assert.equal(
    createAdminWorkSchema.safeParse({
      codigo: "obra com espaço",
      nome: "Obra válida",
      responsavelId: "00000000-0000-4000-8000-000000000001",
    }).success,
    false,
  );
});

test("exige responsável em novas obras e permite atribuí-lo em obras antigas", () => {
  assert.equal(
    createAdminWorkSchema.safeParse({ codigo: "OBR-1", nome: "Obra sem responsável" }).success,
    false,
  );
  assert.equal(
    updateAdminWorkSchema.safeParse({
      responsavelId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
});

test("normaliza a UF e exige local no formato Cidade - UF", () => {
  const valid = createAdminWorkSchema.parse({
    codigo: "OBR-2",
    nome: "Obra Goiânia",
    local: "Goiânia - go",
    responsavelId: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(valid.local, "Goiânia - GO");
  assert.equal(
    createAdminWorkSchema.safeParse({
      codigo: "OBR-3",
      nome: "Local inválido",
      local: "Goiânia/GO",
      responsavelId: "00000000-0000-4000-8000-000000000001",
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

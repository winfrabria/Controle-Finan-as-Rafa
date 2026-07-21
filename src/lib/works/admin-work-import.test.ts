import assert from "node:assert/strict";
import test from "node:test";

import { parseAdminWorksCsv } from "./admin-work-import";

test("normaliza CSV de obras e preserva local como Cidade - UF", () => {
  const result = parseAdminWorksCsv(
    [
      "codigo,nome,cidade,uf,responsavel,status",
      'obr-001,"Residencial, Horizonte",Goiânia,go,Carlos Menezes,Ativa',
      "obr-002,Centro Empresarial,Rio Branco,AC,Fernanda Lima,Inativa",
    ].join("\n"),
  );

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows[0], {
    linha: 2,
    codigo: "OBR-001",
    nome: "Residencial, Horizonte",
    local: "Goiânia - GO",
    responsavel: "Carlos Menezes",
    ativa: true,
  });
  assert.equal(result.rows[1]?.local, "Rio Branco - AC");
  assert.equal(result.rows[1]?.ativa, false);
});

test("rejeita cabeçalho incompleto, UF e status inválidos", () => {
  const missing = parseAdminWorksCsv("codigo,nome\nOBR-1,Obra");
  assert.equal(missing.issues[0]?.campo, "cabecalho");

  const invalid = parseAdminWorksCsv(
    "codigo,nome,cidade,uf,responsavel,status\nOBR-1,Obra,São Paulo,SPO,,pausada",
  );
  assert.deepEqual(
    new Set(invalid.issues.map((issue) => issue.campo)),
    new Set(["uf", "responsavel", "status"]),
  );
});

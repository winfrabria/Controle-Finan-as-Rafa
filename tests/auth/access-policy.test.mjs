import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_ONLY_ROLES,
  canAccess,
  getRoleDestination,
  getRoleHome,
  INTERNAL_ROLES,
  REVIEW_ROLES,
} from "../../src/server/auth/access-policy.ts";
import {
  getAuthLandingPath,
  getSafeRedirectPath,
} from "../../src/lib/supabase/redirect.ts";

test("ADMIN pode acessar áreas administrativas e de revisão", () => {
  assert.equal(canAccess("ADMIN", ADMIN_ONLY_ROLES), true);
  assert.equal(canAccess("ADMIN", REVIEW_ROLES), true);
  assert.equal(canAccess("ADMIN", INTERNAL_ROLES), true);
});

test("REVIEWER não pode acessar áreas administrativas", () => {
  assert.equal(canAccess("REVIEWER", ADMIN_ONLY_ROLES), false);
  assert.equal(canAccess("REVIEWER", REVIEW_ROLES), true);
  assert.equal(canAccess("REVIEWER", INTERNAL_ROLES), true);
});

test("cada papel possui uma rota inicial própria", () => {
  assert.equal(getRoleHome("ADMIN"), "/admin");
  assert.equal(getRoleHome("REVIEWER"), "/revisao");
});

test("todo destino pós-login passa pelo landing sem aceitar redirecionamento externo", () => {
  assert.equal(getAuthLandingPath("/revisao?aba=pendentes"), "/auth/landing?next=%2Frevisao%3Faba%3Dpendentes");
  assert.equal(getAuthLandingPath("https://exemplo.com"), "/auth/landing");
  assert.equal(getAuthLandingPath("//exemplo.com"), "/auth/landing");
  assert.equal(getSafeRedirectPath("/admin\\logs"), "/auth/landing");
});

test("ADMIN recebe o equivalente administrativo do next solicitado", () => {
  const cases = [
    ["/auth/landing", "/admin"],
    ["/revisao", "/admin"],
    ["/revisao/notas?status=suspeita", "/admin/notas?status=suspeita"],
    ["/revisao/validacoes", "/admin/validacoes"],
    ["/revisao/historico#ultimas", "/admin/historico#ultimas"],
    ["/notas", "/admin/notas"],
    ["/validacoes", "/admin/validacoes"],
    ["/notas/nota-1", "/notas/nota-1"],
    ["/notas/nota-1/analise-ia", "/notas/nota-1/analise-ia"],
  ];

  for (const [requested, expected] of cases) {
    assert.equal(getRoleDestination("ADMIN", requested), expected);
  }
});

test("REVIEWER recebe o equivalente de revisão e não entra em áreas ADMIN", () => {
  const cases = [
    ["/auth/landing", "/revisao"],
    ["/admin", "/revisao"],
    ["/admin/notas?status=suspeita", "/revisao/notas?status=suspeita"],
    ["/admin/validacoes", "/revisao/validacoes"],
    ["/admin/historico#ultimas", "/revisao/historico#ultimas"],
    ["/admin/logs?nivel=erro", "/revisao?nivel=erro"],
    ["/notas", "/revisao/notas"],
    ["/validacoes", "/revisao/validacoes"],
    ["/notas/nota-1", "/notas/nota-1"],
    ["/notas/nota-1/analise-ia", "/notas/nota-1/analise-ia"],
  ];

  for (const [requested, expected] of cases) {
    assert.equal(getRoleDestination("REVIEWER", requested), expected);
  }
});

test("sessão autenticada prioriza claims verificadas antes do fallback remoto", () => {
  const source = readFileSync(
    new URL("../../src/server/auth/authorization.ts", import.meta.url),
    "utf8",
  );
  const claimsIndex = source.indexOf("supabase.auth.getClaims()");
  const userIndex = source.indexOf("supabase.auth.getUser()");

  assert.ok(claimsIndex >= 0);
  assert.ok(userIndex > claimsIndex);
  assert.match(source, /claimsData\?\.claims\?\.sub/);
});

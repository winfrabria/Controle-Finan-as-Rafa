import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HARNESS_VERSIONS } from "../src/lib/audit-harness/versions";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";

// Check the HTTP process, not .next files or a second local TS process. A
// successful build alone does not prove the app has loaded the new version.
async function main() {
  assertIsolatedHarnessTargets();
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  assert(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname) && base.port === "3117");
  const credentials = await readFile("tmp/ACESSO_LOCAL.md", "utf8");
  const password = credentials.match(/Senha[^\r\n]*`([^`]+)`/)?.[1];
  assert(password, "Credenciais locais não encontradas.");
  const form = new FormData();
  form.set("email", "admin@harness.local.invalid");
  form.set("password", password);
  const login = await fetch(new URL("/auth/login", base), {
    method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(login.status, 303, "Login local não concluído.");
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert(cookie, "Login local não retornou sessão.");
  const response = await fetch(new URL("/api/admin/ai/health", base), {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "Health autenticado indisponível.");
  const health = await response.json();
  console.log(JSON.stringify({ runtimeVersions: health.versions, sourceVersions: HARNESS_VERSIONS,
    status: health.status, verificationMode: health.verification?.mode, jobs: health.jobs }));
  assert.deepEqual(health.versions, HARNESS_VERSIONS,
    "O servidor está executando outra versão. Pare-o, compile e inicie novamente antes de testar.");
  assert.equal(health.status, "ok", "O ambiente local requer atenção.");
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Falha ao verificar o ambiente local.");
  process.exitCode = 1;
});

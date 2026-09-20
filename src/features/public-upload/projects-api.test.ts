import assert from "node:assert/strict";
import test from "node:test";
import { projectMatchesSearch, requestProjects } from "./projects-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("carrega e valida as obras públicas", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const obras = [{ id: "obra-1", nome: "Obra 01", local: "Goiânia - GO" }];

  const result = await requestProjects({
    fetchImpl: async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ obras });
    },
  });

  assert.deepEqual(result, obras);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/obras");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(calls[0]?.init?.credentials, "same-origin");
});

test("busca considera código, nome e local sem depender do código estar no nome", () => {
  const project = { id: "synthetic", nome: "Praça Central", codigo: "TEST-207", local: "Goiânia" };
  for (const query of ["test-207", "praca", "GOIANIA", " "]) assert.equal(projectMatchesSearch(project, query), true);
  assert.equal(projectMatchesSearch(project, "outra obra"), false);
});

test("repete uma vez quando a primeira consulta falha", async () => {
  let calls = 0;

  const result = await requestProjects({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Falha de rede");
      return jsonResponse({ obras: [{ id: "obra-2", nome: "Obra 02" }] });
    },
    retryDelayMs: 0,
  });

  assert.equal(calls, 2);
  assert.equal(result[0]?.id, "obra-2");
});

test("interrompe consultas presas e não mantém a tela carregando para sempre", async () => {
  let calls = 0;
  const stalledFetch: typeof fetch = async (_input, init) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  await assert.rejects(
    requestProjects({
      fetchImpl: stalledFetch,
      retryDelayMs: 0,
      timeoutMs: 5,
    }),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls, 2);
});

test("rejeita respostas com obras sem contrato válido", async () => {
  await assert.rejects(
    requestProjects({
      attempts: 1,
      fetchImpl: async () => jsonResponse({ obras: [{ nome: "Sem id" }] }),
    }),
    /PROJECTS_INVALID_RESPONSE/,
  );
});

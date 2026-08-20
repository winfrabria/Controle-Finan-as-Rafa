import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createServiceWorkerHarness,
  createWorkerRequest,
  createWorkerResponse,
} from "./service-worker-harness";

const workspace = path.resolve(import.meta.dirname, "../..");
const workerSource = readFileSync(path.join(workspace, "public", "sw.js"), "utf8");
const origin = "https://winfrabr.test";

function classify(
  harness: ReturnType<typeof createServiceWorkerHarness>,
  request: ReturnType<typeof createWorkerRequest>,
) {
  return harness.evaluate<string>("classifyRequest(__request)", {
    __request: request,
  });
}

function cacheWrites(harness: ReturnType<typeof createServiceWorkerHarness>) {
  return harness.operations.filter(({ operation }) => operation === "put");
}

test("classifica somente assets públicos allowlisted para cache", () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });

  assert.equal(
    classify(
      harness,
      createWorkerRequest("/_next/static/chunks/app-a1b2c3.js", {
        destination: "script",
        origin,
      }),
    ),
    "cache-first",
  );
  assert.equal(
    classify(
      harness,
      createWorkerRequest("/brand/icon-192.png", {
        destination: "image",
        origin,
      }),
    ),
    "stale-while-revalidate",
  );
  for (const pathName of [
    "/images/bg-blueprint.png",
    "/uploads/nota.pdf",
    "/documents/nota.pdf",
    "/random/photo.png",
    "/_next/image?url=https%3A%2F%2Fexample.test%2Fprivate.png&w=640&q=75",
  ]) {
    assert.equal(
      classify(
        harness,
        createWorkerRequest(pathName, { destination: "image", origin }),
      ),
      "network-only",
      pathName,
    );
  }
});

test("rotas privadas, APIs e autenticação são sempre network-only", async () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });

  for (const pathName of [
    "/api/health",
    "/api/notas/123/status",
    "/api/notas/123/preview",
    "/auth/callback?code=secret",
    "/admin",
    "/admin/logs",
    "/revisao/notas",
    "/notas/123/analise-ia",
    "/validacoes",
  ]) {
    const request = createWorkerRequest(pathName, { origin });
    assert.equal(
      classify(harness, request),
      "network-only",
      pathName,
    );
    const result = await harness.dispatchFetch(request);
    assert.equal(result.responded, false, pathName);
  }
  assert.deepEqual(harness.operations, []);
  assert.deepEqual(harness.fetchCalls, []);
});

test("Range, prefetch e assets com query não podem contornar a allowlist", () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });
  const requests = [
    createWorkerRequest("/brand/icon-512.png", {
      headers: { Range: "bytes=0-1023" },
      origin,
    }),
    createWorkerRequest("/brand/icon-512.png", {
      headers: { Purpose: "prefetch" },
      origin,
    }),
    createWorkerRequest("/brand/icon-512.png?token=sensitive", { origin }),
    createWorkerRequest("/_next/static/chunks/app.js?signature=private", { origin }),
  ];
  for (const request of requests) {
    assert.equal(classify(harness, request), "network-only", request.url);
  }
});

test("navegações usam rede com fallback, sem transformar HTML privado em cacheável", () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });

  for (const pathName of ["/", "/enviar-nota", "/admin", "/notas/123"]) {
    assert.equal(
      classify(
        harness,
        createWorkerRequest(pathName, {
          destination: "document",
          mode: "navigate",
          origin,
        }),
      ),
      "navigation-network-only",
      pathName,
    );
  }
});

test("mutações e uploads nunca entram em estratégia de cache ou replay", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const harness = createServiceWorkerHarness(workerSource, { origin });
    const request = createWorkerRequest("/api/notas", { method, origin });
    assert.equal(classify(harness, request), "network-only");
    const result = await harness.dispatchFetch(request);
    assert.equal(result.responded, false, `${method} não deve ser interceptado`);
    assert.deepEqual(harness.operations, []);
    assert.deepEqual(harness.fetchCalls, []);
  }
});

test("RSC e prefetch do Next permanecem fora do Cache Storage", async () => {
  const requests = [
    createWorkerRequest("/admin?_rsc=abc123", { origin }),
    createWorkerRequest("/revisao/notas", {
      headers: { RSC: "1" },
      origin,
    }),
    createWorkerRequest("/notas/123", {
      headers: { "Next-Router-Prefetch": "1" },
      origin,
    }),
    createWorkerRequest("/admin", {
      headers: { "Next-Router-State-Tree": "encoded-private-state" },
      origin,
    }),
  ];

  for (const request of requests) {
    const harness = createServiceWorkerHarness(workerSource, { origin });
    assert.equal(classify(harness, request), "network-only", request.url);
    await harness.dispatchFetch(request);
    assert.deepEqual(cacheWrites(harness), [], request.url);
  }
});

test("origens externas e URLs assinadas nunca são interceptadas ou persistidas", async () => {
  const externalUrls = [
    "https://project.supabase.co/storage/v1/object/sign/notas/private.pdf?token=secret",
    "https://cdn.example.test/documento.pdf?signature=secret",
    "https://api.example.test/data.json",
  ];

  for (const url of externalUrls) {
    const harness = createServiceWorkerHarness(workerSource, { origin });
    const request = createWorkerRequest(url, { destination: "image", origin });
    assert.equal(classify(harness, request), "network-only", url);
    const result = await harness.dispatchFetch(request);
    assert.equal(result.responded, false, url);
    assert.deepEqual(harness.operations, [], url);
    assert.deepEqual(harness.fetchCalls, [], url);
  }
});

test("cache-first atende hit local e grava somente resposta segura", async () => {
  const bootstrap = createServiceWorkerHarness(workerSource, { origin });
  const cacheName = bootstrap.evaluate<string>("STATIC_CACHE_NAME");
  const assetUrl = `${origin}/_next/static/chunks/app-a1b2c3.js`;
  const cachedHarness = createServiceWorkerHarness(workerSource, {
    initialCaches: {
      [cacheName]: {
        [assetUrl]: createWorkerResponse("cached asset"),
      },
    },
    origin,
  });
  const hit = await cachedHarness.dispatchFetch(
    createWorkerRequest(assetUrl, { destination: "script", origin }),
  );
  assert.equal(await hit.response?.text(), "cached asset");
  assert.equal(cachedHarness.fetchCalls.length, 0);

  const missHarness = createServiceWorkerHarness(workerSource, {
    fetch: async () => createWorkerResponse("fresh asset"),
    origin,
  });
  const miss = await missHarness.dispatchFetch(
    createWorkerRequest(assetUrl, { destination: "script", origin }),
  );
  assert.equal(await miss.response?.text(), "fresh asset");
  assert.equal(cacheWrites(missHarness).length, 1);
});

test("falha ao gravar Cache Storage não derruba uma resposta válida da rede", async () => {
  const harness = createServiceWorkerHarness(workerSource, {
    cachePutError: new Error("quota exceeded"),
    fetch: async () => createWorkerResponse("asset entregue pela rede"),
    origin,
  });

  const result = await harness.dispatchFetch(
    createWorkerRequest("/_next/static/chunks/network-safe.js", {
      destination: "script",
      origin,
    }),
  );

  assert.equal(await result.response?.text(), "asset entregue pela rede");
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(cacheWrites(harness).length, 1);
});

test("cache runtime é limitado sem remover os recursos do precache", async () => {
  const bootstrap = createServiceWorkerHarness(workerSource, { origin });
  const cacheName = bootstrap.evaluate<string>("STATIC_CACHE_NAME");
  const maximum = bootstrap.evaluate<number>("MAX_RUNTIME_CACHE_ENTRIES");
  const entries: Record<string, Response> = {
    [`${origin}/offline.html`]: createWorkerResponse("offline"),
  };
  for (let index = 0; index < maximum; index += 1) {
    entries[`${origin}/_next/static/chunks/old-${index}.js`] =
      createWorkerResponse(`old-${index}`);
  }
  const harness = createServiceWorkerHarness(workerSource, {
    fetch: async () => createWorkerResponse("fresh"),
    initialCaches: { [cacheName]: entries },
    origin,
  });

  await harness.dispatchFetch(
    createWorkerRequest("/_next/static/chunks/fresh.js", {
      destination: "script",
      origin,
    }),
  );

  const stored = harness.stores.get(cacheName)!;
  assert.ok(stored.has(`${origin}/offline.html`));
  assert.equal(
    [...stored.keys()].filter((url) => url.includes("/_next/static/")).length,
    maximum,
  );
  assert.equal(stored.has(`${origin}/_next/static/chunks/old-0.js`), false);
  assert.ok(stored.has(`${origin}/_next/static/chunks/fresh.js`));
});

test("stale-while-revalidate serve o asset público e atualiza em background", async () => {
  const bootstrap = createServiceWorkerHarness(workerSource, { origin });
  const cacheName = bootstrap.evaluate<string>("STATIC_CACHE_NAME");
  const assetUrl = `${origin}/brand/icon-192.png`;
  const harness = createServiceWorkerHarness(workerSource, {
    fetch: async () => createWorkerResponse("refreshed brand"),
    initialCaches: {
      [cacheName]: {
        [assetUrl]: createWorkerResponse("cached brand"),
      },
    },
    origin,
  });

  const result = await harness.dispatchFetch(
    createWorkerRequest(assetUrl, { destination: "image", origin }),
  );
  assert.equal(await result.response?.text(), "cached brand");
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(cacheWrites(harness).length, 1);
  assert.equal(
    await (await harness.stores.get(cacheName)!.get(assetUrl)!.text()),
    "refreshed brand",
  );
});

test("no-store, respostas opacas e falhas HTTP nunca são gravadas", async () => {
  const cases = [
    createWorkerResponse("private", {
      headers: { "Cache-Control": "private, no-store" },
    }),
    createWorkerResponse("opaque", { type: "opaque" }),
    createWorkerResponse("failure", { status: 503 }),
  ];

  for (const response of cases) {
    const harness = createServiceWorkerHarness(workerSource, {
      fetch: async () => response,
      origin,
    });
    await harness.dispatchFetch(
      createWorkerRequest("/_next/static/chunks/fresh-d4e5f6.js", {
        destination: "script",
        origin,
      }),
    );
    assert.deepEqual(cacheWrites(harness), []);
  }
});

test("offline em qualquer navegação retorna somente o fallback neutro", async () => {
  const harness = createServiceWorkerHarness(workerSource, {
    fetch: async () => {
      throw new TypeError("offline");
    },
    origin,
  });
  await harness.dispatchInstall();

  for (const pathName of ["/", "/admin", "/revisao/notas", "/notas/123"]) {
    const result = await harness.dispatchFetch(
      createWorkerRequest(pathName, {
        destination: "document",
        mode: "navigate",
        origin,
      }),
    );
    assert.equal(result.responded, true);
    assert.match(await result.response!.text(), /precache:\/offline\.html/);
  }
  assert.deepEqual(cacheWrites(harness), []);
});

test("activate remove somente caches WinfraBR antigos e preserva terceiros", async () => {
  const bootstrap = createServiceWorkerHarness(workerSource, { origin });
  const current = bootstrap.evaluate<string>("STATIC_CACHE_NAME");
  const harness = createServiceWorkerHarness(workerSource, {
    initialCaches: {
      [current]: {},
      "another-product-cache-v1": {},
      "winfrabr-pwa-stale-v0": {},
      "winfrabr-static-stale-v0": {},
    },
    origin,
  });

  await harness.dispatchActivate();
  assert.ok(harness.stores.has(current));
  assert.ok(harness.stores.has("another-product-cache-v1"));
  assert.equal(harness.stores.has("winfrabr-pwa-stale-v0"), false);
  assert.ok(
    harness.stores.has("winfrabr-static-stale-v0"),
    "o worker só pode apagar caches pertencentes ao prefixo exato winfrabr-pwa-",
  );
  assert.equal(harness.claimCount, 1);
});

test("SKIP_WAITING exige mensagem explícita e não ocorre no install", async () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });
  await harness.dispatchInstall();
  assert.equal(harness.skipWaitingCount, 0);

  await harness.dispatchMessage({ type: "IGNORED" });
  await harness.dispatchMessage("SKIP_WAITING");
  assert.equal(harness.skipWaitingCount, 0);

  await harness.dispatchMessage({ type: "SKIP_WAITING" });
  assert.equal(harness.skipWaitingCount, 1);
});

test("precache contém somente recursos públicos same-origin", async () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });
  await harness.dispatchInstall();
  const cachedUrls = [...harness.stores.values()].flatMap((entries) => [
    ...entries.keys(),
  ]);

  assert.ok(cachedUrls.includes(`${origin}/offline.html`));
  assert.ok(cachedUrls.some((url) => url.endsWith("/brand/icon-192.png")));
  assert.ok(cachedUrls.some((url) => url.endsWith("/brand/icon-512.png")));
  for (const url of cachedUrls) {
    assert.equal(new URL(url).origin, origin);
    assert.doesNotMatch(
      new URL(url).pathname,
      /^\/(api|auth|admin|revisao|notas|validacoes)(\/|$)/,
    );
  }
});

test("push mostra texto genérico, atualiza badge e abre somente rota permitida", async () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });
  const path = "/revisao/notas?anexo=123";

  await harness.dispatchPush({
    body: "Um anexo requer sua consulta. Abra o aplicativo para ver os detalhes.",
    notificationId: "notification-123",
    path,
    tag: "winfrabr-note-123",
    title: "Novo diagnóstico no WinfraBR",
    unreadCount: 3,
  });

  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0]?.title, "Novo diagnóstico no WinfraBR");
  assert.equal(harness.notifications[0]?.options.body?.includes("fornecedor"), false);
  assert.equal(harness.badgeCount, 3);

  await harness.dispatchNotificationClick(
    harness.notifications[0]?.options.data,
  );
  assert.deepEqual(harness.openedWindows, [`${origin}${path}`]);
  assert.equal(harness.badgeCount, 2);
  assert.ok(
    harness.fetchCalls.some((call) =>
      typeof call === "string" && call === `${origin}/api/notificacoes`
    ),
  );
});

test("push malformado não injeta URL externa nem dados do documento", async () => {
  const harness = createServiceWorkerHarness(workerSource, { origin });
  await harness.dispatchPush({
    body: 10,
    path: "https://evil.example/roubo",
    title: null,
    unreadCount: -1,
  });

  assert.equal(harness.notifications.length, 1);
  assert.match(harness.notifications[0]?.title ?? "", /WinfraBR/);
  assert.doesNotMatch(
    harness.notifications[0]?.options.body ?? "",
    /fornecedor|valor|arquivo/i,
  );
  await harness.dispatchNotificationClick(harness.notifications[0]?.options.data);
  assert.deepEqual(harness.openedWindows, [`${origin}/revisao/notas`]);
});

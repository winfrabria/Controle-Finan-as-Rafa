import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import nextConfig from "../../next.config";
import { config as proxyConfig } from "../../src/proxy";

const workspace = path.resolve(import.meta.dirname, "../..");

function matcherAccepts(pathname: string) {
  const sources = (
    Array.isArray(proxyConfig.matcher)
      ? proxyConfig.matcher
      : [proxyConfig.matcher]
  ) as readonly (string | { source: string })[];
  return sources.some((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return new RegExp(`^${source}$`).test(pathname);
  });
}

async function configuredHeaders(pathname: string) {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  const rule = rules.find((candidate) => candidate.source === pathname);
  assert.ok(rule, `cabeçalhos ausentes para ${pathname}`);
  return new Map(
    rule.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
}

test("offline.html é estático, neutro e não executa código", async () => {
  const html = await readFile(path.join(workspace, "public", "offline.html"), "utf8");
  assert.match(html, /offline|sem conexão|sem conexao/i);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|caches\./i);
  assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i);
  assert.doesNotMatch(html, /\beval\s*\(|new\s+Function\b|\bimport\s*\(|document\.cookie/i);
  assert.doesNotMatch(html, /\{\{|\}\}|<%=|<\?=/);
  assert.doesNotMatch(html, /fornecedor|número da nota|numero da nota|valor total|token|signed[_-]?url/i);
});

test("worker tem cabeçalhos que impedem retenção HTTP e ampliam o escopo", async () => {
  const headers = await configuredHeaders("/sw.js");
  assert.match(headers.get("content-type") ?? "", /javascript/i);
  assert.match(headers.get("cache-control") ?? "", /no-cache/i);
  assert.match(headers.get("cache-control") ?? "", /no-store/i);
  assert.match(headers.get("cache-control") ?? "", /must-revalidate/i);
  assert.equal(headers.get("service-worker-allowed"), "/");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
});

test("manifesto recebe MIME e revalidação explícitos", async () => {
  const headers = await configuredHeaders("/manifest.webmanifest");
  assert.match(headers.get("content-type") ?? "", /application\/manifest\+json/i);
  const cacheControl = headers.get("cache-control") ?? "";
  assert.match(cacheControl, /max-age=0|no-cache|must-revalidate/i);
  assert.doesNotMatch(cacheControl, /immutable/i);
});

test("proxy ignora os arquivos públicos essenciais da PWA", () => {
  for (const pathname of [
    "/sw.js",
    "/manifest.webmanifest",
    "/offline.html",
    "/brand/icon-192.png",
    "/brand/icon-512.png",
  ]) {
    assert.equal(matcherAccepts(pathname), false, pathname);
  }

  assert.equal(matcherAccepts("/admin"), true);
  assert.equal(matcherAccepts("/api/health"), true);
});

test("navegação do Rafael aquece rotas completas somente na memória da sessão", async () => {
  const source = await readFile(
    path.join(
      workspace,
      "src",
      "features",
      "workspace-ui",
      "reviewer-portal-frame.tsx",
    ),
    "utf8",
  );

  assert.match(source, /PrefetchKind\.FULL/);
  assert.match(source, /router\.prefetch\(route,/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|caches\./i);
});

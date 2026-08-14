import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import manifestFactory from "../../src/app/manifest";

const workspace = path.resolve(import.meta.dirname, "../..");

function pngDimensions(bytes: Buffer) {
  const signature = bytes.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "o asset deve ser um PNG válido");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  };
}

test("manifesto identifica uma PWA standalone dentro do escopo raiz", () => {
  const manifest = manifestFactory();

  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "pt-BR");
  assert.match(String(manifest.name), /WinfraBR/i);
  assert.ok(manifest.short_name);
  assert.match(String(manifest.background_color), /^#[0-9a-f]{6}$/i);
  assert.match(String(manifest.theme_color), /^#[0-9a-f]{6}$/i);
});

test("todos os ícones declarados existem e correspondem às dimensões informadas", async () => {
  const manifest = manifestFactory();
  assert.ok(manifest.icons && manifest.icons.length >= 2);

  const declaredSizes = new Set<string>();
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png");
    assert.ok(icon.src.startsWith("/"), "ícones devem ser same-origin");
    assert.ok(icon.sizes, "cada ícone deve declarar suas dimensões");
    const expected = /^(\d+)x(\d+)$/.exec(icon.sizes);
    assert.ok(expected, `dimensão inválida: ${icon.sizes}`);

    const file = path.join(workspace, "public", icon.src.replace(/^\//, ""));
    const actual = pngDimensions(await readFile(file));
    assert.deepEqual(actual, {
      height: Number(expected[2]),
      width: Number(expected[1]),
    });
    declaredSizes.add(icon.sizes);
  }

  assert.ok(declaredSizes.has("192x192"));
  assert.ok(declaredSizes.has("512x512"));
});

test("manifesto não declara maskable sem um asset dedicado", () => {
  const manifest = manifestFactory();
  for (const icon of manifest.icons ?? []) {
    if (String(icon.purpose ?? "").split(/\s+/).includes("maskable")) {
      assert.match(icon.src, /maskable/i);
    }
  }
});

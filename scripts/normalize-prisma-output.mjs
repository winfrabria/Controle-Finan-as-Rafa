import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The tracked Prisma client is generated code. Remove only trailing horizontal
// whitespace emitted by the generator, keeping regeneration diff-check clean.
async function normalize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await normalize(path);
    else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const original = await readFile(path, "utf8");
      const formatted = original.replace(/[\t ]+(?=\r?$)/gm, "")
        .replace(/(?:\r?\n)+$/, original.includes("\r\n") ? "\r\n" : "\n");
      if (formatted !== original) await writeFile(path, formatted, "utf8");
    }
  }
}

await normalize(fileURLToPath(new URL("../src/generated/prisma/", import.meta.url)));

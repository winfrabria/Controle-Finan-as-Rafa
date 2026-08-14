import { readFile, writeFile } from "node:fs/promises";

const workerPath = new URL("../public/sw.js", import.meta.url);
const rawVersion =
  process.env.PWA_BUILD_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "";

const version = rawVersion.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);

if (version) {
  const source = await readFile(workerPath, "utf8");
  const stamped = source.replace(
    /const WORKER_VERSION = "[^"]+";/,
    `const WORKER_VERSION = "${version}";`,
  );

  if (stamped === source) {
    throw new Error("Não foi possível localizar WORKER_VERSION em public/sw.js.");
  }

  await writeFile(workerPath, stamped, "utf8");
  console.log(`PWA worker version: ${version}`);
}

/** Guard any fixture writes. Never rely on a test flag alone to select a DB. */
export function assertIsolatedHarnessTargets(environment: Record<string, string | undefined> = process.env) {
  if (environment.HARNESS_ISOLATED_LOCAL !== "true") throw new Error("HARNESS_ISOLATED_LOCAL=true is required for test writes.");
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const url = new URL(environment[key] ?? "");
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.port !== "55322" || url.pathname !== "/postgres") throw new Error(`${key} must target the isolated local database on port 55322.`);
  }
  const api = new URL(environment.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (api.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(api.hostname) || api.port !== "55321") {
    throw new Error("Supabase must target the isolated local API on port 55321.");
  }
}

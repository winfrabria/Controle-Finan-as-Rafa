import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { assertIsolatedHarnessTargets } from "../src/server/testing/isolated-harness";
import { prisma } from "../src/server/db/prisma";

assertIsolatedHarnessTargets();
const password = process.env.LOCAL_HARNESS_PASSWORD;
if (!password || password.length < 16) throw new Error("Set a private LOCAL_HARNESS_PASSWORD (at least 16 characters).");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function main() {
try {
  const listing = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (listing.error) throw listing.error;
  const profileIds: Record<string, string> = {};
  for (const role of ["ADMIN", "REVIEWER"] as const) {
    const email = `${role.toLowerCase()}@harness.local.invalid`;
    let user = listing.data.users.find((candidate) => candidate.email === email);
    if (!user) {
      const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { full_name: `Teste isolado · ${role}` } });
      if (created.error || !created.data.user) throw created.error ?? new Error("Test user creation failed.");
      user = created.data.user;
    }
    await prisma.profile.upsert({ where: { id: user.id }, create: { id: user.id, email, role, fullName: `Teste isolado · ${role}` },
      update: { role, active: true } });
    profileIds[role] = user.id;
  }
  const work = await prisma.work.upsert({ where: { code: "LOCAL-104" },
    create: { code: "LOCAL-104", name: "Obra 104 · Teste isolado", responsibleProfileId: profileIds.REVIEWER, responsibleName: "Revisor de teste" },
    update: { active: true, responsibleProfileId: profileIds.REVIEWER } });
  console.log(JSON.stringify({ localOnly: true, profiles: Object.keys(profileIds), workId: work.id, workCode: work.code }));
} finally {
  await prisma.$disconnect();
}
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local seed failed.");
  process.exitCode = 1;
});

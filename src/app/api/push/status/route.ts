import { NextResponse } from "next/server";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";
import { getWebPushPublicStatus } from "@/server/push/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const subscriptionCount = await prisma.pushSubscription.count({
    where: {
      profileId: access.profile.id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  return NextResponse.json(
    { ...getWebPushPublicStatus(), subscriptionCount },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

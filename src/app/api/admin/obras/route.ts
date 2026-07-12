import { NextRequest, NextResponse } from "next/server";

import {
  createAdminWorkSchema,
  listAdminWorksQuerySchema,
} from "@/lib/works/admin-work-contract";
import { recordAdminAudit } from "@/server/audit/admin-audit";
import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import {
  malformedJsonError,
  workServiceError,
  workValidationError,
} from "@/server/works/admin-work-http";
import {
  createAdminWork,
  listAdminWorks,
} from "@/server/works/admin-work-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  const parsed = listAdminWorksQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) return workValidationError(parsed.error);

  try {
    const result = await listAdminWorks(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workServiceError(error, "list admin");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return malformedJsonError();
  }

  const parsed = createAdminWorkSchema.safeParse(body);
  if (!parsed.success) return workValidationError(parsed.error);

  try {
    const obra = await createAdminWork(parsed.data);
    recordAdminAudit({
      action: "work.created",
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      entityId: obra.id,
      changes: parsed.data,
    });

    return NextResponse.json({ obra }, { status: 201 });
  } catch (error) {
    return workServiceError(error, "create");
  }
}

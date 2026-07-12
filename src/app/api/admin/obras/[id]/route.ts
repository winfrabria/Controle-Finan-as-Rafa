import { NextRequest, NextResponse } from "next/server";

import {
  adminWorkIdSchema,
  updateAdminWorkSchema,
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
  getAdminWork,
  updateAdminWork,
} from "@/server/works/admin-work-service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  const id = adminWorkIdSchema.safeParse((await context.params).id);
  if (!id.success) return workValidationError(id.error);

  try {
    const obra = await getAdminWork(id.data);
    return NextResponse.json(
      { obra },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return workServiceError(error, "get admin");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  const id = adminWorkIdSchema.safeParse((await context.params).id);
  if (!id.success) return workValidationError(id.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return malformedJsonError();
  }

  const parsed = updateAdminWorkSchema.safeParse(body);
  if (!parsed.success) return workValidationError(parsed.error);

  try {
    const obra = await updateAdminWork(id.data, parsed.data);
    const action =
      parsed.data.ativa === false
        ? "work.deactivated"
        : parsed.data.ativa === true
          ? "work.reactivated"
          : "work.updated";
    recordAdminAudit({
      action,
      actorId: auth.profile.id,
      actorEmail: auth.profile.email,
      entityId: obra.id,
      changes: parsed.data,
    });

    return NextResponse.json({ obra });
  } catch (error) {
    return workServiceError(error, "update");
  }
}

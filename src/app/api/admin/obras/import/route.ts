import { NextRequest, NextResponse } from "next/server";

import { adminWorkImportRequestSchema } from "@/lib/works/admin-work-contract";
import { recordAdminAudit } from "@/server/audit/admin-audit";
import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import {
  malformedJsonError,
  workServiceError,
  workValidationError,
} from "@/server/works/admin-work-http";
import { importAdminWorks } from "@/server/works/admin-work-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return malformedJsonError();
  }

  const parsed = adminWorkImportRequestSchema.safeParse(body);
  if (!parsed.success) return workValidationError(parsed.error);

  try {
    const result = await importAdminWorks(
      parsed.data.csv,
      parsed.data.modo === "aplicar",
    );
    if (parsed.data.modo === "aplicar" && !result.valido) {
      return NextResponse.json(result, { status: 422 });
    }
    if (result.aplicado) {
      recordAdminAudit({
        action: "work.imported",
        actorId: auth.profile.id,
        actorEmail: auth.profile.email,
        entityId: crypto.randomUUID(),
        changes: { total: result.totalLinhas },
      });
    }
    return NextResponse.json(result, { status: result.aplicado ? 201 : 200 });
  } catch (error) {
    return workServiceError(error, "import");
  }
}

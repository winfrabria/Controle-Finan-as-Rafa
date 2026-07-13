import { NextResponse } from "next/server";

import { ADMIN_ONLY_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { listResponsibleProfiles } from "@/server/works/admin-work-service";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApiRoles(ADMIN_ONLY_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const responsaveis = await listResponsibleProfiles();
    return NextResponse.json(
      { responsaveis },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to list responsible profiles", error);
    return NextResponse.json(
      { error: "Não foi possível carregar os responsáveis." },
      { status: 503 },
    );
  }
}

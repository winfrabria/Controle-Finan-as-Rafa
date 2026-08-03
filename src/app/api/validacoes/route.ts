import { NextResponse } from "next/server";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireApiRoles(INTERNAL_ROLES);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      erro: {
        codigo: "DECISAO_LEGADA_DESATIVADA",
        mensagem: "Aprovação e rejeição estão desativadas no MVP; o histórico permanece somente para consulta administrativa.",
      },
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

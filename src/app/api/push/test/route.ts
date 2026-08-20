import { NextResponse } from "next/server";
import { z } from "zod";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { isSameOriginMutation } from "@/server/http/same-origin";
import { sendTestPushToSubscription } from "@/server/push/delivery-service";

export const runtime = "nodejs";

const requestSchema = z.object({ endpoint: z.string().url().max(4096) });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { erro: { codigo: "ORIGEM_INVALIDA", mensagem: "Origem da solicitação inválida." } },
      { status: 403 },
    );
  }
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { erro: { codigo: "INSCRICAO_INVALIDA", mensagem: "Inscrição de notificação inválida." } },
      { status: 400 },
    );
  }

  const result = await sendTestPushToSubscription({
    endpoint: parsed.data.endpoint,
    profileId: access.profile.id,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        erro: {
          codigo: result.code,
          mensagem:
            result.status === 410
              ? "A inscrição expirou. Ative as notificações novamente."
              : "Não foi possível enviar a notificação de teste.",
        },
      },
      { status: result.status },
    );
  }

  return NextResponse.json({ enviada: true });
}

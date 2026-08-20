import { NextResponse } from "next/server";
import { z } from "zod";

import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";
import { isSameOriginMutation } from "@/server/http/same-origin";
import { getWebPushConfig } from "@/server/push/config";

export const runtime = "nodejs";

const endpointSchema = z.string().url().max(4096).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "O endpoint precisa usar HTTPS.");

const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    auth: z.string().min(8).max(512),
    p256dh: z.string().min(32).max(512),
  }),
});

const deleteSchema = z.object({ endpoint: endpointSchema });

function forbiddenOrigin() {
  return NextResponse.json(
    { erro: { codigo: "ORIGEM_INVALIDA", mensagem: "Origem da solicitação inválida." } },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return forbiddenOrigin();
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;
  if (!getWebPushConfig()) {
    return NextResponse.json(
      {
        erro: {
          codigo: "PUSH_NAO_CONFIGURADO",
          mensagem: "As notificações ainda não foram configuradas no servidor.",
        },
      },
      { status: 503 },
    );
  }

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { erro: { codigo: "INSCRICAO_INVALIDA", mensagem: "Inscrição de notificação inválida." } },
      { status: 400 },
    );
  }

  const subscription = await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    create: {
      auth: parsed.data.keys.auth,
      endpoint: parsed.data.endpoint,
      expiresAt: parsed.data.expirationTime
        ? new Date(parsed.data.expirationTime)
        : null,
      p256dh: parsed.data.keys.p256dh,
      profileId: access.profile.id,
      userAgent: request.headers.get("user-agent")?.slice(0, 500),
    },
    update: {
      auth: parsed.data.keys.auth,
      expiresAt: parsed.data.expirationTime
        ? new Date(parsed.data.expirationTime)
        : null,
      p256dh: parsed.data.keys.p256dh,
      profileId: access.profile.id,
      userAgent: request.headers.get("user-agent")?.slice(0, 500),
    },
    select: { id: true },
  });

  return NextResponse.json(
    { ativa: true, id: subscription.id },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return forbiddenOrigin();
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { erro: { codigo: "INSCRICAO_INVALIDA", mensagem: "Inscrição de notificação inválida." } },
      { status: 400 },
    );
  }

  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, profileId: access.profile.id },
  });
  return NextResponse.json({ removidas: result.count });
}

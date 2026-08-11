import { NextResponse } from "next/server";

import { NotificationType } from "@/generated/prisma/enums";
import { notificationPath } from "@/features/internal-notes/notification-path";
import { INTERNAL_ROLES } from "@/server/auth/access-policy";
import { requireApiRoles } from "@/server/auth/authorization";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toneFor(type: NotificationType) {
  if (type === NotificationType.PROCESSING_FAILED) return "danger" as const;
  if (type === NotificationType.VALIDATION_REQUIRED) return "warning" as const;
  return "info" as const;
}

function timeFor(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

export async function GET(request: Request) {
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 50)
    : 20;
  const basePath = access.profile.role === "ADMIN" ? "/admin" : "/revisao";

  const rows = await prisma.notification.findMany({
    where: { recipientId: access.profile.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      body: true,
      createdAt: true,
      id: true,
      note: {
        select: {
          documentNumber: true,
          id: true,
          noteReads: {
            where: { profileId: access.profile.id },
            select: { readAt: true },
            take: 1,
          },
        },
      },
      readAt: true,
      title: true,
      type: true,
    },
  });

  return NextResponse.json(
    {
      notificacoes: rows.map((notification) => {
        const noteId = notification.note?.id;
        return {
          detail: notification.body,
          id: notification.id,
          path: notificationPath({
            basePath,
            documentNumber: notification.note?.documentNumber,
            isRead: Boolean(notification.note?.noteReads.length),
            noteId,
          }),
          readAt: notification.readAt?.toISOString() ?? null,
          time: timeFor(notification.createdAt),
          title: notification.title,
          tone: toneFor(notification.type),
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const access = await requireApiRoles(INTERNAL_ROLES);
  if (!access.ok) return access.response;

  let body: { all?: boolean; id?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { erro: { codigo: "CORPO_INVALIDO", mensagem: "Envie um corpo JSON válido." } },
      { status: 400 },
    );
  }

  if (body.all === true) {
    const result = await prisma.notification.updateMany({
      where: { recipientId: access.profile.id, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ atualizadas: result.count });
  }

  if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return NextResponse.json(
      { erro: { codigo: "NOTIFICACAO_INVALIDA", mensagem: "Notificação inválida." } },
      { status: 400 },
    );
  }

  const result = await prisma.notification.updateMany({
    where: { id: body.id, recipientId: access.profile.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { erro: { codigo: "NOTIFICACAO_NAO_ENCONTRADA", mensagem: "Notificação não encontrada." } },
      { status: 404 },
    );
  }

  return NextResponse.json({ atualizadas: result.count });
}

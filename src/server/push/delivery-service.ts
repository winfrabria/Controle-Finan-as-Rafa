import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  NotificationType,
  PushDeliveryStatus,
  UserRole,
} from "@/generated/prisma/enums";
import {
  buildSuspiciousNotePushPayload,
  buildTestPushPayload,
} from "@/lib/push/push-contract";
import { prisma } from "@/server/db/prisma";

import { getWebPushConfig } from "./config";
import {
  classifyPushSendFailure,
  sendWebPush,
} from "./web-push-client";

const DEFAULT_BATCH_SIZE = 12;
const MAX_BATCH_SIZE = 30;

type NotificationWithPushInput = {
  body: string;
  data?: Prisma.InputJsonValue;
  eventKey: string;
  noteId: string;
  recipientId: string;
  title: string;
  type: NotificationType;
};

export async function createNotificationWithPushDeliveries(
  transaction: Prisma.TransactionClient,
  input: NotificationWithPushInput,
) {
  const notification = await transaction.notification.create({
    data: {
      body: input.body,
      data: input.data,
      noteId: input.noteId,
      recipientId: input.recipientId,
      title: input.title,
      type: input.type,
    },
    select: { id: true },
  });
  const subscriptions = await transaction.pushSubscription.findMany({
    where: {
      profileId: input.recipientId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });

  if (subscriptions.length > 0) {
    await transaction.pushDelivery.createMany({
      data: subscriptions.map((subscription) => ({
        eventKey: input.eventKey,
        notificationId: notification.id,
        subscriptionId: subscription.id,
      })),
      skipDuplicates: true,
    });
  }

  return notification.id;
}

function retryDelayMs(attempt: number) {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

async function claimDelivery(id: string, workerId: string) {
  return prisma.$transaction(async (transaction) => {
    const delivery = await transaction.pushDelivery.findUnique({
      where: { id },
      include: {
        notification: {
          select: {
            id: true,
            noteId: true,
            recipientId: true,
          },
        },
        subscription: {
          select: {
            auth: true,
            endpoint: true,
            expiresAt: true,
            id: true,
            p256dh: true,
            profile: { select: { role: true } },
          },
        },
      },
    });

    if (
      !delivery ||
      (delivery.status !== PushDeliveryStatus.PENDING &&
        delivery.status !== PushDeliveryStatus.FAILED) ||
      delivery.availableAt > new Date() ||
      delivery.attempt >= delivery.maxAttempts
    ) {
      return null;
    }

    if (
      delivery.subscription.expiresAt &&
      delivery.subscription.expiresAt <= new Date()
    ) {
      await transaction.pushSubscription.delete({
        where: { id: delivery.subscription.id },
      });
      return null;
    }

    const claimed = await transaction.pushDelivery.updateMany({
      where: {
        attempt: delivery.attempt,
        id,
        status: { in: [PushDeliveryStatus.PENDING, PushDeliveryStatus.FAILED] },
      },
      data: {
        attempt: { increment: 1 },
        lastError: null,
        lastErrorCode: null,
        lockedAt: new Date(),
        lockedBy: workerId,
        status: PushDeliveryStatus.SENDING,
      },
    });

    return claimed.count === 1
      ? { ...delivery, attempt: delivery.attempt + 1 }
      : null;
  });
}

async function sendClaimedDelivery(id: string, workerId: string) {
  const delivery = await claimDelivery(id, workerId);
  if (!delivery || !delivery.notification.noteId) {
    return { accepted: false, expired: false, skipped: true };
  }

  const unreadCount = await prisma.notification.count({
    where: {
      readAt: null,
      recipientId: delivery.notification.recipientId,
    },
  });
  const payload = buildSuspiciousNotePushPayload({
    noteId: delivery.notification.noteId,
    notificationId: delivery.notification.id,
    unreadCount,
  });

  try {
    await sendWebPush(
      {
        endpoint: delivery.subscription.endpoint,
        expirationTime: delivery.subscription.expiresAt?.getTime() ?? null,
        keys: {
          auth: delivery.subscription.auth,
          p256dh: delivery.subscription.p256dh,
        },
      },
      delivery.subscription.profile.role === UserRole.ADMIN
        ? { ...payload, path: payload.path.replace("/revisao/", "/admin/") }
        : payload,
    );
    await prisma.pushDelivery.updateMany({
      where: {
        id,
        lockedBy: workerId,
        status: PushDeliveryStatus.SENDING,
      },
      data: {
        acceptedAt: new Date(),
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        status: PushDeliveryStatus.ACCEPTED,
      },
    });
    return { accepted: true, expired: false, skipped: false };
  } catch (error) {
    const failure = classifyPushSendFailure(error);
    if (failure.expired) {
      await prisma.pushSubscription.deleteMany({
        where: { id: delivery.subscription.id },
      });
      return { accepted: false, expired: true, skipped: false };
    }

    const exhausted = delivery.attempt >= delivery.maxAttempts;
    const retryable = failure.retryable && !exhausted;
    await prisma.pushDelivery.updateMany({
      where: {
        id,
        lockedBy: workerId,
        status: PushDeliveryStatus.SENDING,
      },
      data: {
        availableAt: retryable
          ? new Date(Date.now() + retryDelayMs(delivery.attempt))
          : new Date(),
        completedAt: retryable ? null : new Date(),
        lastError: failure.message,
        lastErrorCode: failure.code,
        lockedAt: null,
        lockedBy: null,
        status: retryable
          ? PushDeliveryStatus.FAILED
          : PushDeliveryStatus.CANCELLED,
      },
    });
    return { accepted: false, expired: false, skipped: false };
  }
}

export async function dispatchPendingPushDeliveries(options: {
  batchSize?: number;
  noteId?: string;
} = {}) {
  if (!getWebPushConfig()) {
    return { accepted: 0, configured: false, expired: 0, processed: 0 };
  }

  const staleBefore = new Date(Date.now() - 2 * 60_000);
  await prisma.pushDelivery.updateMany({
    where: {
      attempt: { lt: prisma.pushDelivery.fields.maxAttempts },
      lockedAt: { lt: staleBefore },
      status: PushDeliveryStatus.SENDING,
    },
    data: {
      availableAt: new Date(),
      lastError: "A tentativa anterior foi interrompida e será repetida.",
      lastErrorCode: "PUSH_LEASE_EXPIRED",
      lockedAt: null,
      lockedBy: null,
      status: PushDeliveryStatus.FAILED,
    },
  });
  await prisma.pushDelivery.updateMany({
    where: {
      attempt: { gte: prisma.pushDelivery.fields.maxAttempts },
      lockedAt: { lt: staleBefore },
      status: PushDeliveryStatus.SENDING,
    },
    data: {
      completedAt: new Date(),
      lastError: "As tentativas de notificação foram encerradas.",
      lastErrorCode: "PUSH_ATTEMPTS_EXHAUSTED",
      lockedAt: null,
      lockedBy: null,
      status: PushDeliveryStatus.CANCELLED,
    },
  });

  const batchSize = Math.min(
    Math.max(Math.trunc(options.batchSize ?? DEFAULT_BATCH_SIZE), 1),
    MAX_BATCH_SIZE,
  );
  const candidates = await prisma.pushDelivery.findMany({
    where: {
      attempt: { lt: prisma.pushDelivery.fields.maxAttempts },
      availableAt: { lte: new Date() },
      notification: options.noteId ? { noteId: options.noteId } : undefined,
      status: { in: [PushDeliveryStatus.PENDING, PushDeliveryStatus.FAILED] },
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
    take: batchSize,
  });
  const workerId = `push:${randomUUID()}`;
  const results = await Promise.all(
    candidates.map((candidate) => sendClaimedDelivery(candidate.id, workerId)),
  );

  return {
    accepted: results.filter((result) => result.accepted).length,
    configured: true,
    expired: results.filter((result) => result.expired).length,
    processed: results.filter((result) => !result.skipped).length,
  };
}

export async function sendTestPushToSubscription(input: {
  endpoint: string;
  profileId: string;
}) {
  if (!getWebPushConfig()) {
    return { code: "PUSH_NOT_CONFIGURED", ok: false as const, status: 503 };
  }

  const subscription = await prisma.pushSubscription.findFirst({
    where: { endpoint: input.endpoint, profileId: input.profileId },
  });
  if (!subscription) {
    return { code: "PUSH_SUBSCRIPTION_NOT_FOUND", ok: false as const, status: 404 };
  }
  const unreadCount = await prisma.notification.count({
    where: { readAt: null, recipientId: input.profileId },
  });

  try {
    await sendWebPush(
      {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expiresAt?.getTime() ?? null,
        keys: { auth: subscription.auth, p256dh: subscription.p256dh },
      },
      buildTestPushPayload(unreadCount),
    );
    return { ok: true as const };
  } catch (error) {
    const failure = classifyPushSendFailure(error);
    if (failure.expired) {
      await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
    }
    return {
      code: failure.code,
      ok: false as const,
      status: failure.expired ? 410 : failure.retryable ? 503 : 400,
    };
  }
}

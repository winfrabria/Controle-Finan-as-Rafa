import "server-only";

import webPush, { type PushSubscription as WebPushSubscription } from "web-push";

import type { PushNotificationPayload } from "@/lib/push/push-contract";

import { getWebPushConfig } from "./config";

export type PushSendFailure = {
  code: string;
  expired: boolean;
  message: string;
  retryable: boolean;
  statusCode?: number;
};

export class PushConfigurationError extends Error {
  constructor() {
    super("As notificações push ainda não foram configuradas no servidor.");
    this.name = "PushConfigurationError";
  }
}

type WebPushErrorLike = Error & { statusCode?: number };

export function classifyPushSendFailure(error: unknown): PushSendFailure {
  const statusCode =
    error instanceof Error && "statusCode" in error
      ? Number((error as WebPushErrorLike).statusCode)
      : undefined;

  if (statusCode === 404 || statusCode === 410) {
    return {
      code: "PUSH_SUBSCRIPTION_EXPIRED",
      expired: true,
      message: "A inscrição deste aparelho expirou.",
      retryable: false,
      statusCode,
    };
  }

  if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
    return {
      code: `PUSH_PROVIDER_${statusCode}`,
      expired: false,
      message: "O serviço de notificações está temporariamente indisponível.",
      retryable: true,
      statusCode,
    };
  }

  if (statusCode !== undefined && statusCode >= 400) {
    return {
      code: `PUSH_PROVIDER_${statusCode}`,
      expired: false,
      message: "O serviço recusou esta notificação.",
      retryable: false,
      statusCode,
    };
  }

  return {
    code: "PUSH_NETWORK_ERROR",
    expired: false,
    message: "Não foi possível contatar o serviço de notificações.",
    retryable: true,
  };
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: PushNotificationPayload,
) {
  const config = getWebPushConfig();
  if (!config) throw new PushConfigurationError();

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return webPush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 5 * 60,
    timeout: 10_000,
    urgency: "high",
  });
}

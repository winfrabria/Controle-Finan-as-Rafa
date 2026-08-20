export const DEFAULT_PUSH_PATH = "/revisao/notas";
export const PUSH_NOTIFICATION_TITLE = "Novo diagnóstico no WinfraBR";
export const PUSH_NOTIFICATION_BODY =
  "Um anexo requer sua consulta. Abra o aplicativo para ver os detalhes.";

export type PushNotificationPayload = {
  body: string;
  notificationId?: string;
  path: string;
  tag: string;
  title: string;
  unreadCount?: number;
};

export function isAllowedPushPath(path: string) {
  return /^(?:\/(?:admin|revisao)\/(?:notas|historico)|\/notas\/[^/?#]+)(?:[/?#]|$)/.test(
    path,
  );
}

export function safePushPath(path: unknown) {
  return typeof path === "string" && isAllowedPushPath(path)
    ? path
    : DEFAULT_PUSH_PATH;
}

export function buildSuspiciousNotePushPayload(input: {
  noteId: string;
  notificationId: string;
  unreadCount?: number;
}): PushNotificationPayload {
  return {
    body: PUSH_NOTIFICATION_BODY,
    notificationId: input.notificationId,
    path: `/revisao/notas?anexo=${encodeURIComponent(input.noteId)}`,
    tag: `winfrabr-note-${input.noteId}`,
    title: PUSH_NOTIFICATION_TITLE,
    unreadCount: input.unreadCount,
  };
}

export function buildTestPushPayload(unreadCount?: number): PushNotificationPayload {
  return {
    body: "As notificações estão ativas neste aparelho.",
    path: DEFAULT_PUSH_PATH,
    tag: `winfrabr-test-${Date.now()}`,
    title: "Notificação de teste",
    unreadCount,
  };
}

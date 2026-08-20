export type BrowserPushSupport = {
  reason?: "insecure" | "unsupported";
  supported: boolean;
};

export function browserPushSupport(): BrowserPushSupport {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return { reason: "insecure", supported: false };
  }
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { reason: "unsupported", supported: false };
  }
  return { supported: true };
}

export function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function getPushRegistration(createIfMissing = false) {
  if (!browserPushSupport().supported) return null;
  let registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration && createIfMissing) {
    await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    registration = await navigator.serviceWorker.ready;
  }
  return registration ?? null;
}

export function serializedSubscription(subscription: PushSubscription) {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.auth || !value.keys.p256dh) {
    throw new Error("A inscrição criada pelo navegador está incompleta.");
  }
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: { auth: value.keys.auth, p256dh: value.keys.p256dh },
  };
}

export async function unregisterCurrentPushDevice() {
  if (!browserPushSupport().supported) return;
  const registration = await getPushRegistration(false);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await Promise.allSettled([
    fetch("/api/push/subscriptions", {
      body: JSON.stringify({ endpoint }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    }),
    subscription.unsubscribe(),
  ]);
}

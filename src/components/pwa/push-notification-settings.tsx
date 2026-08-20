"use client";

import { useEffect, useState } from "react";

import {
  browserPushSupport,
  getPushRegistration,
  serializedSubscription,
  unregisterCurrentPushDevice,
  urlBase64ToUint8Array,
} from "@/lib/push/push-client";

import styles from "./push-notification-settings.module.css";

type PushState =
  | "checking"
  | "inactive"
  | "activating"
  | "active"
  | "blocked"
  | "unsupported"
  | "unconfigured"
  | "error";

type StatusResponse = {
  configured: boolean;
  publicKey: string | null;
  subscriptionCount: number;
};

function errorMessage(state: PushState) {
  if (state === "blocked") {
    return "O navegador bloqueou os avisos. Libere as notificações nas configurações do aparelho.";
  }
  if (state === "unsupported") {
    return "Este navegador não oferece notificações para o aplicativo instalado.";
  }
  if (state === "unconfigured") {
    return "As notificações ainda não foram configuradas neste ambiente.";
  }
  if (state === "error") {
    return "Não foi possível atualizar a configuração. Tente novamente.";
  }
  return null;
}

export function PushNotificationSettings() {
  const [state, setState] = useState<PushState>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [deviceCount, setDeviceCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const support = browserPushSupport();
      if (!support.supported) {
        if (active) setState("unsupported");
        return;
      }

      try {
        const response = await fetch("/api/push/status", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("push status unavailable");
        const payload = (await response.json()) as StatusResponse;
        if (!active) return;
        setDeviceCount(payload.subscriptionCount);
        setPublicKey(payload.publicKey);
        if (!payload.configured || !payload.publicKey) {
          setState("unconfigured");
          return;
        }
        if (Notification.permission === "denied") {
          setState("blocked");
          return;
        }

        const registration = await getPushRegistration(false);
        const subscription = await registration?.pushManager.getSubscription();
        if (!active) return;
        if (!subscription) {
          setState("inactive");
          return;
        }

        const reconciliation = await fetch("/api/push/subscriptions", {
          body: JSON.stringify(serializedSubscription(subscription)),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!reconciliation.ok) throw new Error("push reconciliation failed");
        if (active) setState("active");
      } catch {
        if (active) setState("error");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function activate() {
    if (!publicKey) return;
    setFeedback(null);
    setState("activating");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "inactive");
        return;
      }
      const registration = await getPushRegistration(true);
      if (!registration) throw new Error("service worker unavailable");
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          applicationServerKey: urlBase64ToUint8Array(publicKey),
          userVisibleOnly: true,
        }));
      const response = await fetch("/api/push/subscriptions", {
        body: JSON.stringify(serializedSubscription(subscription)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error("subscription persistence failed");
      }
      setDeviceCount((count) => Math.max(1, count));
      setState("active");
      setFeedback("Avisos ativados neste aparelho.");
    } catch {
      setState("error");
    }
  }

  async function deactivate() {
    setFeedback(null);
    setState("activating");
    try {
      await unregisterCurrentPushDevice();
      setDeviceCount((count) => Math.max(0, count - 1));
      setState("inactive");
      setFeedback("Avisos desativados neste aparelho.");
    } catch {
      setState("error");
    }
  }

  async function sendTest() {
    setFeedback("Enviando teste…");
    try {
      const registration = await getPushRegistration(false);
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setState("inactive");
        setFeedback(null);
        return;
      }
      const response = await fetch("/api/push/test", {
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("test push failed");
      setFeedback("Teste enviado. Ele pode levar alguns segundos para aparecer.");
    } catch {
      setFeedback("Não foi possível enviar o teste.");
    }
  }

  const unavailable = errorMessage(state);
  return (
    <section className={styles.card} aria-label="Notificações neste aparelho">
      <div className={styles.heading}>
        <span aria-hidden="true" className={styles.bell}>●</span>
        <span>
          <strong>Avisos no aparelho</strong>
          <small>
            {state === "active"
              ? "Ativo para novos anexos suspeitos"
              : "Receba um aviso quando houver algo para consultar"}
          </small>
        </span>
        <i className={state === "active" ? styles.on : styles.off}>
          {state === "active" ? "Ativo" : "Inativo"}
        </i>
      </div>

      {unavailable ? <p className={styles.message}>{unavailable}</p> : null}
      {feedback ? <p className={styles.feedback}>{feedback}</p> : null}

      {state === "inactive" || (state === "error" && publicKey) ? (
        <button className={styles.primary} onClick={activate} type="button">
          Ativar neste aparelho
        </button>
      ) : null}
      {state === "error" && !publicKey ? (
        <button
          className={styles.primary}
          onClick={() => window.location.reload()}
          type="button"
        >
          Verificar novamente
        </button>
      ) : null}
      {state === "active" ? (
        <div className={styles.actions}>
          <button onClick={sendTest} type="button">Enviar teste</button>
          <button onClick={deactivate} type="button">Desativar</button>
        </div>
      ) : null}
      {state === "activating" || state === "checking" ? (
        <p className={styles.loading}>Verificando configuração…</p>
      ) : null}
      {state === "active" && deviceCount > 1 ? (
        <small className={styles.devices}>{deviceCount} aparelhos vinculados à sua conta</small>
      ) : null}
    </section>
  );
}

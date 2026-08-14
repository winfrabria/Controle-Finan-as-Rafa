"use client";

import { useEffect, useRef, useState } from "react";

import {
  isPwaCriticalActivityActive,
  PWA_CRITICAL_ACTIVITY_EVENT,
  type PwaCriticalActivityDetail,
} from "./pwa-critical-activity";
import styles from "./pwa-lifecycle.module.css";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

const LOCAL_PWA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PWA_LOCAL === "true";
const WINFRA_CACHE_PREFIX = "winfrabr-pwa-";
const UPDATE_INTERVAL_MS = 60 * 60 * 1_000;
const INSTALL_DISMISS_KEY = "winfrabr.pwa-install-dismissed";

export function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function shouldRegisterPwa(
  environment: string,
  hostname: string,
  localEnabled: boolean,
) {
  return environment === "production" || (isLocalHostname(hostname) && localEnabled);
}

export function isIosLike(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
) {
  return /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

async function clearDisabledLocalWorker() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = registration?.active || registration?.waiting || registration?.installing;
  if (worker && new URL(worker.scriptURL).pathname === "/sw.js") {
    await registration?.unregister();
  }
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(WINFRA_CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );
}

export function PwaLifecycle() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const updateApplyRequestedRef = useRef(false);
  const [criticalActivity, setCriticalActivity] = useState(false);
  const [deferredInstall, setDeferredInstall] =
    useState<DeferredInstallPrompt | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [iosInstall, setIosInstall] = useState(false);
  const [online, setOnline] = useState(true);
  const [recentlyRecovered, setRecentlyRecovered] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setStandalone(isStandalone());
      setIosInstall(
        isIosLike(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
      );
      try {
        setInstallDismissed(window.sessionStorage.getItem(INSTALL_DISMISS_KEY) === "true");
      } catch {
        // Session Storage pode estar indisponível em modos restritivos do navegador.
      }
    });

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstall(event as DeferredInstallPrompt);
    };
    const onAppInstalled = () => {
      setDeferredInstall(null);
      setStandalone(true);
    };
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = () => setStandalone(isStandalone());

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let recoveryTimer: number | undefined;
    queueMicrotask(() => {
      if (active) setOnline(navigator.onLine);
    });

    const onOffline = () => {
      window.clearTimeout(recoveryTimer);
      setRecentlyRecovered(false);
      setOnline(false);
    };
    const onOnline = () => {
      setOnline(true);
      setRecentlyRecovered(true);
      recoveryTimer = window.setTimeout(() => setRecentlyRecovered(false), 4_000);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.clearTimeout(recoveryTimer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setCriticalActivity(isPwaCriticalActivityActive());
      }
    });
    const onCriticalActivity = (event: Event) => {
      const detail = (event as CustomEvent<PwaCriticalActivityDetail>).detail;
      setCriticalActivity(detail?.active === true);
    };
    window.addEventListener(PWA_CRITICAL_ACTIVITY_EVENT, onCriticalActivity);
    return () => {
      active = false;
      window.removeEventListener(PWA_CRITICAL_ACTIVITY_EVENT, onCriticalActivity);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const hostname = window.location.hostname;
    const enabled = shouldRegisterPwa(
      process.env.NODE_ENV,
      hostname,
      LOCAL_PWA_ENABLED,
    );
    if (!enabled) {
      if (process.env.NODE_ENV === "development" && isLocalHostname(hostname)) {
        void clearDisabledLocalWorker();
      }
      return;
    }

    let active = true;
    let updateTimer: number | undefined;
    const installingListeners = new Map<ServiceWorker, EventListener>();

    const watchRegistration = (registration: ServiceWorkerRegistration) => {
      registrationRef.current = registration;
      if (registration.waiting && navigator.serviceWorker.controller) {
        setUpdateAvailable(true);
      }

      const watchInstalling = (installing: ServiceWorker | null) => {
        if (!installing) return;
        const onStateChange = () => {
          if (
            active &&
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            setUpdateAvailable(true);
          }
        };
        installingListeners.set(installing, onStateChange);
        installing.addEventListener("statechange", onStateChange);
      };
      const onUpdateFound = () => watchInstalling(registration.installing);
      registration.addEventListener("updatefound", onUpdateFound);
      watchInstalling(registration.installing);
      return () => registration.removeEventListener("updatefound", onUpdateFound);
    };

    let unwatchRegistration: () => void = () => undefined;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (!active) return;
        unwatchRegistration = watchRegistration(registration);
        updateTimer = window.setInterval(() => {
          if (document.visibilityState === "visible") void registration.update();
        }, UPDATE_INTERVAL_MS);
      } catch {
        // A aplicação web continua funcional quando o navegador recusa o worker.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void registrationRef.current?.update();
      }
    };
    const onControllerChange = () => {
      if (!updateApplyRequestedRef.current) return;
      updateApplyRequestedRef.current = false;
      window.location.reload();
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      active = false;
      window.clearInterval(updateTimer);
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      unwatchRegistration();
      installingListeners.forEach((listener, worker) =>
        worker.removeEventListener("statechange", listener),
      );
      installingListeners.clear();
    };
  }, []);

  async function requestInstall() {
    if (!deferredInstall) return;
    try {
      await deferredInstall.prompt();
      await deferredInstall.userChoice;
    } finally {
      setDeferredInstall(null);
      dismissInstall();
    }
  }

  function dismissInstall() {
    try {
      window.sessionStorage.setItem(INSTALL_DISMISS_KEY, "true");
    } catch {
      // A dispensa ainda vale enquanto este componente permanecer montado.
    }
    setInstallDismissed(true);
  }

  function applyUpdate() {
    const busy = criticalActivity || isPwaCriticalActivityActive();
    const waiting = registrationRef.current?.waiting;
    if (busy || !online || !waiting) return;
    updateApplyRequestedRef.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  const showInstall =
    !standalone && !installDismissed && (deferredInstall !== null || iosInstall);
  if (!showInstall && online && !recentlyRecovered && !updateAvailable) return null;

  return (
    <aside className={styles.stack} aria-label="Estado do aplicativo">
      {!online ? (
        <section className={`${styles.notice} ${styles.offline}`} role="alert">
          <div>
            <strong>Você está sem conexão</strong>
            <p>O que já está na tela permanece visível, mas novas ações precisam de internet.</p>
          </div>
        </section>
      ) : null}

      {recentlyRecovered ? (
        <section
          className={`${styles.notice} ${styles.recovered}`}
          role="status"
          aria-live="polite"
        >
          <strong>Conexão restabelecida</strong>
        </section>
      ) : null}

      {updateAvailable ? (
        <section className={styles.notice} role="status" aria-live="polite">
          <div>
            <strong>Nova versão disponível</strong>
            <p>Atualize quando terminar o que está fazendo.</p>
            {criticalActivity ? (
              <p className={styles.busyMessage}>
                Conclua o envio ou a alteração atual antes de atualizar.
              </p>
            ) : null}
          </div>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={criticalActivity || !online}
              onClick={applyUpdate}
              type="button"
            >
              Atualizar agora
            </button>
          </div>
        </section>
      ) : null}

      {showInstall ? (
        <section className={styles.notice} aria-labelledby="pwa-install-title">
          <div>
            <strong id="pwa-install-title">Instale o WinfraBR</strong>
            <p>
              {deferredInstall
                ? "Abra como aplicativo no celular, tablet ou computador."
                : "No iPhone ou iPad, toque em Compartilhar e depois em Adicionar à Tela de Início."}
            </p>
          </div>
          <div className={styles.actions}>
            {deferredInstall ? (
              <button className={styles.primary} onClick={requestInstall} type="button">
                Instalar aplicativo
              </button>
            ) : null}
            <button
              className={styles.secondary}
              onClick={dismissInstall}
              type="button"
            >
              Agora não
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

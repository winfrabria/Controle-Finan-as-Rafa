"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { PushNotificationSettings } from "@/components/pwa/push-notification-settings";

import type { PortalRole } from "../portal-shell";
import { Icon, type IconName } from "../ui-icons";
import styles from "./shell-controls.module.css";

type OpenPanel = "notifications" | "help" | "profile" | null;

type ShellControlsProps = {
  basePath: string;
  role: PortalRole;
  userEmail?: string;
};

type SearchTarget = {
  description: string;
  icon: IconName;
  keywords: string;
  label: string;
  path: string;
};

type Notification = {
  detail: string;
  id: string;
  path: string;
  readAt: string | null;
  time: string;
  title: string;
  tone: "warning" | "info" | "danger";
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function ShellControls({
  basePath,
  role,
  userEmail,
}: ShellControlsProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => setIsMounted(true), 0);
    void fetch("/api/notificacoes?limit=20", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          naoLidas?: number;
          notificacoes?: Notification[];
        };
        return {
          notifications: Array.isArray(payload.notificacoes)
            ? payload.notificacoes
            : [],
          unreadCount:
            typeof payload.naoLidas === "number" ? payload.naoLidas : 0,
        };
      })
      .then((next) => {
        if (active && next) {
          setNotifications(next.notifications);
          setUnreadCount(next.unreadCount);
        }
      })
      .catch(() => {
        if (active) {
          setNotifications([]);
          setUnreadCount(0);
        }
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (
      openPanel !== "profile" ||
      !window.matchMedia("(max-width: 760px)").matches
    ) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [openPanel]);
  const isAdmin = role === "admin";
  const displayName = isAdmin ? "Administrador WinfraBR" : "Rafael";
  const roleName = isAdmin ? "Administrador" : "Gerente Financeiro";

  const searchTargets = useMemo<SearchTarget[]>(
    () => [
      {
        description: "Consultar notas fiscais e fornecedores",
        icon: "document",
        keywords: "nota notas fornecedor fornecedores fiscal",
        label: "Notas fiscais",
        path: `${basePath}/notas`,
      },
      ...(isAdmin
        ? [
            {
              description: "Cadastrar, editar e desativar obras",
              icon: "building" as const,
              keywords: "obra obras projeto local",
              label: "Obras",
              path: `${basePath}/obras`,
            },
            {
              description: "Consultar processamento, auditoria e falhas",
              icon: "clock" as const,
              keywords: "log logs falha ia processamento auditoria",
              label: "Logs técnicos",
              path: `${basePath}/logs`,
            },
          ]
        : []),
    ],
    [basePath, isAdmin],
  );

  const visibleTargets = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return searchTargets;
    return searchTargets.filter((target) =>
      normalize(`${target.label} ${target.keywords}`).includes(normalizedQuery),
    );
  }, [query, searchTargets]);

  useEffect(() => {
    if (!isMounted) return;
    const badgeNavigator = navigator as Navigator & {
      clearAppBadge?: () => Promise<void>;
      setAppBadge?: (contents?: number) => Promise<void>;
    };
    const operation =
      unreadCount > 0
        ? badgeNavigator.setAppBadge?.(unreadCount)
        : badgeNavigator.clearAppBadge?.();
    void operation?.catch(() => undefined);
  }, [isMounted, unreadCount]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenPanel(null);
        setSearchOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPanel(null);
        setSearchOpen(false);
      }
    };
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("keydown", focusSearch);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("keydown", focusSearch);
    };
  }, []);

  const togglePanel = (panel: Exclude<OpenPanel, null>) => {
    setSearchOpen(false);
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  const runSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const firstTarget = visibleTargets[0];
    if (!firstTarget) return;
    const suffix = query.trim()
      ? `?busca=${encodeURIComponent(query.trim())}`
      : "";
    setSearchOpen(false);
    router.push(`${firstTarget.path}${suffix}`);
  };

  const openNotification = (notification: Notification) => {
    if (!notification.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt } : item,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      void fetch("/api/notificacoes", {
        body: JSON.stringify({ id: notification.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    }
    setOpenPanel(null);
  };

  const markAllRead = () => {
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, readAt })),
    );
    setUnreadCount(0);
    void fetch("/api/notificacoes", {
      body: JSON.stringify({ all: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  };

  return (
    <div className={styles.controls} ref={rootRef}>
      <div className={styles.searchWrap}>
        <form className={styles.search} onSubmit={runSearch} role="search">
          <Icon name="search" />
          <input
            aria-label="Buscar na plataforma"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
              setOpenPanel(null);
            }}
            onFocus={() => {
              setSearchOpen(true);
              setOpenPanel(null);
            }}
            placeholder="Buscar notas, obras, fornecedores..."
            ref={searchInputRef}
            value={query}
          />
          <kbd>/</kbd>
        </form>
        {searchOpen && query.trim() ? (
          <div className={styles.searchResults} role="listbox">
            <strong>Resultados rápidos</strong>
            {visibleTargets.length ? (
              visibleTargets.map((target) => (
                <Link
                  href={`${target.path}?busca=${encodeURIComponent(query.trim())}`}
                  key={target.path}
                  onClick={() => setSearchOpen(false)}
                >
                  <span className={styles.resultIcon}>
                    <Icon name={target.icon} />
                  </span>
                  <span>
                    <b>{target.label}</b>
                    <small>{target.description}</small>
                  </span>
                </Link>
              ))
            ) : (
              <p>
                Nenhuma área encontrada. Tente buscar por nota, validação
                {isAdmin ? ", obra ou log" : " ou fornecedor"}.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.tools}>
        <div className={styles.toolWrap}>
          <button
            aria-expanded={openPanel === "notifications"}
            aria-label={`${unreadCount} notificações não lidas`}
            className={styles.iconButton}
            onClick={() => togglePanel("notifications")}
            type="button"
          >
            <Icon name="bell" />
            {isMounted && unreadCount > 0 ? <b>{unreadCount}</b> : null}
          </button>
          {openPanel === "notifications" ? (
            <section className={styles.dropdown} aria-label="Notificações">
              <header>
                <div>
                  <strong>Notificações</strong>
                  <small>{unreadCount} não lidas</small>
                </div>
                <button onClick={markAllRead} type="button">
                  Marcar como lidas
                </button>
              </header>
              <div className={styles.notificationList}>
                {notifications.length ? (
                  notifications.map((notification) => {
                    const isUnread = !notification.readAt;
                    return (
                      <Link
                        className={isUnread ? styles.unread : undefined}
                        href={notification.path}
                        key={notification.id}
                        onClick={() => openNotification(notification)}
                      >
                        <span
                          className={`${styles.notificationDot} ${styles[notification.tone]}`}
                        />
                        <span>
                          <b>{notification.title}</b>
                          <small>{notification.detail}</small>
                          <time>{notification.time}</time>
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <p className={styles.notificationEmpty}>Nenhuma notificação nova.</p>
                )}
              </div>
            </section>
          ) : null}
        </div>

        <div className={`${styles.toolWrap} ${styles.helpWrap}`}>
          <button
            aria-expanded={openPanel === "help"}
            aria-label="Ajuda"
            className={styles.iconButton}
            onClick={() => togglePanel("help")}
            type="button"
          >
            <Icon name="help" />
          </button>
          {openPanel === "help" ? (
            <section className={`${styles.dropdown} ${styles.helpPanel}`}>
              <strong>Central de ajuda</strong>
              <p>
                Encontre rapidamente notas, validações e áreas da plataforma
                usando a busca no topo.
              </p>
              <Link
                href={`${basePath}/notas`}
                onClick={() => setOpenPanel(null)}
              >
                Consultar notas <Icon name="chevron" />
              </Link>
              {isAdmin ? (
                <Link
                  href={`${basePath}/validacoes`}
                  onClick={() => setOpenPanel(null)}
                >
                  Abrir validações <Icon name="chevron" />
                </Link>
              ) : null}
              <small>
                Para suporte técnico, contate o administrador da WinfraBR.
              </small>
            </section>
          ) : null}
        </div>

        <span className={styles.divider} />

        <div className={`${styles.toolWrap} ${styles.profileWrap}`}>
          <button
            aria-label="Abrir meu perfil"
            aria-expanded={openPanel === "profile"}
            className={styles.profileButton}
            onClick={() => togglePanel("profile")}
            type="button"
          >
            <span className={styles.avatar} title={userEmail}>
              {isAdmin ? "AW" : "R"}
            </span>
            <span className={styles.userCopy}>
              <strong>{displayName}</strong>
              <small>{roleName}</small>
            </span>
            <Icon name="chevron" className={styles.chevron} />
          </button>
          {openPanel === "profile" ? (
            <>
              <button
                aria-label="Fechar meu perfil"
                className={styles.profileBackdrop}
                onClick={() => setOpenPanel(null)}
                type="button"
              />
              <section
                aria-label="Meu perfil"
                className={`${styles.dropdown} ${styles.profilePanel}`}
                role="dialog"
              >
                <header className={styles.profileMobileHeader}>
                  <strong>Meu perfil</strong>
                  <button
                    aria-label="Fechar"
                    onClick={() => setOpenPanel(null)}
                    type="button"
                  >
                    <Icon name="close" />
                  </button>
                </header>
                <div className={styles.profileSummary}>
                  <span className={styles.avatar}>{isAdmin ? "AW" : "R"}</span>
                  <span>
                    <strong>{displayName}</strong>
                    <small>{userEmail ?? "Usuário autenticado"}</small>
                    <em>{roleName}</em>
                  </span>
                </div>
                <div className={styles.profileAccess}>
                  <span>Acesso ativo</span>
                  <strong>{roleName}</strong>
                </div>
                {!isAdmin ? <PushNotificationSettings /> : null}
                <nav className={styles.profileNav} aria-label="Atalhos do perfil">
                  <Link href={basePath} onClick={() => setOpenPanel(null)}>
                    <Icon name="home" />
                    <span>
                      <strong>Meu painel</strong>
                      <small>Resumo da operação</small>
                    </span>
                    <Icon name="chevron" />
                  </Link>
                  <Link href={`${basePath}/notas`} onClick={() => setOpenPanel(null)}>
                    <Icon name="document" />
                    <span>
                      <strong>Notas</strong>
                      <small>Diagnósticos da IA</small>
                    </span>
                    <Icon name="chevron" />
                  </Link>
                  <Link
                    href={`${basePath}/historico`}
                    onClick={() => setOpenPanel(null)}
                  >
                    <Icon name="clock" />
                    <span>
                      <strong>Histórico</strong>
                      <small>Anexos acompanhados</small>
                    </span>
                    <Icon name="chevron" />
                  </Link>
                  {isAdmin ? (
                    <Link href={`${basePath}/obras`} onClick={() => setOpenPanel(null)}>
                      <Icon name="building" />
                      <span>
                        <strong>Obras</strong>
                        <small>Cadastros ativos</small>
                      </span>
                      <Icon name="chevron" />
                    </Link>
                  ) : null}
                </nav>
                <LogoutButton className={styles.logout} />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

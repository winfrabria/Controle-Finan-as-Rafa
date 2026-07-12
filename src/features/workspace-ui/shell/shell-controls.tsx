"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { LogoutButton } from "@/components/auth/logout-button";

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
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
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
      {
        description: isAdmin
          ? "Acompanhar as decisões do revisor"
          : "Analisar notas que precisam de decisão",
        icon: "shield",
        keywords: "validacao validacoes suspeita pendente revisar",
        label: "Validações",
        path: `${basePath}/validacoes`,
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

  const notifications = useMemo<Notification[]>(
    () =>
      isAdmin
        ? [
            {
              detail: "3 notas aguardam análise do Rafael.",
              id: "admin-pending",
              path: `${basePath}/validacoes`,
              time: "Há 5 min",
              title: "Validações pendentes",
              tone: "warning",
            },
            {
              detail: "Uma nota não pôde ser lida automaticamente.",
              id: "admin-processing",
              path: `${basePath}/logs`,
              time: "Há 18 min",
              title: "Falha de processamento",
              tone: "danger",
            },
            {
              detail: "A nota NF-12548 foi classificada como suspeita.",
              id: "admin-note",
              path: `${basePath}/notas`,
              time: "Hoje, 09:42",
              title: "Nova inconsistência detectada",
              tone: "info",
            },
          ]
        : [
            {
              detail: "A NF-12548 precisa da sua decisão.",
              id: "review-pending",
              path: `${basePath}/validacoes`,
              time: "Há 5 min",
              title: "Nota suspeita para revisar",
              tone: "warning",
            },
            {
              detail: "Uma nova nota da Obra Alphaville entrou na fila.",
              id: "review-queue",
              path: `${basePath}/validacoes`,
              time: "Há 22 min",
              title: "Nova validação",
              tone: "info",
            },
            {
              detail: "Sua decisão da NF-12491 foi registrada.",
              id: "review-saved",
              path: `${basePath}/notas`,
              time: "Ontem, 16:30",
              title: "Validação salva",
              tone: "info",
            },
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

  const unreadCount = notifications.filter(
    (notification) => !readNotifications.includes(notification.id),
  ).length;

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
    setReadNotifications((current) =>
      current.includes(notification.id)
        ? current
        : [...current, notification.id],
    );
    setOpenPanel(null);
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
            {unreadCount ? <b>{unreadCount}</b> : null}
          </button>
          {openPanel === "notifications" ? (
            <section className={styles.dropdown} aria-label="Notificações">
              <header>
                <div>
                  <strong>Notificações</strong>
                  <small>{unreadCount} não lidas</small>
                </div>
                <button
                  onClick={() =>
                    setReadNotifications(
                      notifications.map((notification) => notification.id),
                    )
                  }
                  type="button"
                >
                  Marcar como lidas
                </button>
              </header>
              <div className={styles.notificationList}>
                {notifications.map((notification) => {
                  const isUnread = !readNotifications.includes(notification.id);
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
                })}
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
              <Link
                href={`${basePath}/validacoes`}
                onClick={() => setOpenPanel(null)}
              >
                Abrir validações <Icon name="chevron" />
              </Link>
              <small>
                Para suporte técnico, contate o administrador da WinfraBR.
              </small>
            </section>
          ) : null}
        </div>

        <span className={styles.divider} />

        <div className={`${styles.toolWrap} ${styles.profileWrap}`}>
          <button
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
            <section className={`${styles.dropdown} ${styles.profilePanel}`}>
              <div className={styles.profileSummary}>
                <span className={styles.avatar}>{isAdmin ? "AW" : "R"}</span>
                <span>
                  <strong>{displayName}</strong>
                  <small>{userEmail ?? "Usuário autenticado"}</small>
                  <em>{roleName}</em>
                </span>
              </div>
              <Link href={basePath} onClick={() => setOpenPanel(null)}>
                <Icon name="home" /> Meu painel
              </Link>
              <LogoutButton className={styles.logout} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

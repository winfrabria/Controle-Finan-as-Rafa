import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";

import { Brand, Icon, type IconName } from "./ui-icons";
import styles from "./workspace-ui.module.css";

export type PortalRole = "admin" | "reviewer";
export type PortalSection =
  | "dashboard"
  | "notas"
  | "validacoes"
  | "obras"
  | "logs";

const menu: { id: PortalSection; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "notas", label: "Notas", icon: "document" },
  { id: "validacoes", label: "Validações", icon: "shield" },
  { id: "obras", label: "Obras", icon: "building" },
  { id: "logs", label: "Logs", icon: "clock" },
];

type PortalShellProps = {
  active: PortalSection;
  children: ReactNode;
  role: PortalRole;
  userEmail?: string;
  basePath?: string;
};

export function PortalShell({
  active,
  children,
  role,
  userEmail,
  basePath = role === "admin" ? "/admin" : "/revisao",
}: PortalShellProps) {
  const isAdmin = role === "admin";
  const visibleMenu = menu.filter(
    (item) => isAdmin || !["obras", "logs"].includes(item.id),
  );
  const displayName = isAdmin ? "Administrador WinfraBR" : "Rafael";
  const roleName = isAdmin ? "Administrador" : "Gerente Financeiro";
  const notificationCount = isAdmin ? 7 : 3;

  return (
    <div className={styles.portal}>
      <aside className={styles.side}>
        <Link href={basePath} className={styles.brandLink}>
          <Brand />
        </Link>
        <nav className={styles.sideNav} aria-label="Navegação principal">
          {visibleMenu.map((item) => (
            <Link
              key={item.id}
              href={`${basePath}${item.id === "dashboard" ? "" : `/${item.id}`}`}
              className={active === item.id ? styles.navActive : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.sideActions}>
          <button type="button">
            <Icon name="chevron" /> Recolher menu
          </button>
          <LogoutButton className={styles.signout} />
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <Link href={basePath} className={styles.mobileBrand}>
            <Brand />
          </Link>
          <label className={styles.search}>
            <Icon name="search" />
            <input
              placeholder="Buscar notas, obras, fornecedores..."
              aria-label="Buscar"
            />
          </label>
          <div className={styles.userTools}>
            <button
              className={styles.notification}
              type="button"
              aria-label={`${notificationCount} notificações`}
            >
              <Icon name="bell" />
              <b>{notificationCount}</b>
            </button>
            <button className={styles.help} type="button" aria-label="Ajuda">
              <Icon name="help" />
            </button>
            <span className={styles.userDivider} />
            <span className={styles.avatar} title={userEmail}>
              {isAdmin ? "AW" : "R"}
            </span>
            <span className={styles.userCopy}>
              <strong>{displayName}</strong>
              <small>{roleName}</small>
            </span>
            <Icon name="chevron" className={styles.userChevron} />
          </div>
        </header>
        <main className={styles.portalContent}>{children}</main>
        <footer className={styles.portalFooter}>
          <span>
            <Icon name="shield" /> Ambiente seguro e em conformidade com a LGPD
          </span>
          <span>
            <Icon name="lock" /> Seus dados estão protegidos com criptografia de
            ponta a ponta.
          </span>
          <span>
            © 2024 <strong>WinfraBR</strong>. Todos os direitos reservados.
          </span>
        </footer>
      </section>

      <nav className={styles.mobileNav} aria-label="Navegação mobile">
        {visibleMenu.slice(0, 3).map((item) => (
          <Link
            key={item.id}
            href={`${basePath}${item.id === "dashboard" ? "" : `/${item.id}`}`}
            className={active === item.id ? styles.mobileActive : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
        <Link
          href={isAdmin ? `${basePath}/obras` : `${basePath}/menu`}
          className={
            active === "obras" || active === "logs"
              ? styles.mobileActive
              : undefined
          }
        >
          <Icon name={isAdmin ? "building" : "menu"} />
          <span>{isAdmin ? "Obras" : "Menu"}</span>
        </Link>
      </nav>
    </div>
  );
}

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageIntro}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function StatusBadge({
  children,
  tone = "ok",
}: {
  children: ReactNode;
  tone?: "ok" | "warning" | "danger" | "info";
}) {
  return (
    <span className={`${styles.status} ${styles[`status_${tone}`]}`}>
      {children}
    </span>
  );
}

export function MetricCard({
  icon,
  label,
  value,
  footnote,
  tone = "blue",
}: {
  icon: IconName;
  label: string;
  value: string;
  footnote: string;
  tone?: "blue" | "green" | "orange" | "purple";
}) {
  return (
    <article className={styles.metric}>
      <span className={`${styles.metricIcon} ${styles[`metric_${tone}`]}`}>
        <Icon name={icon} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      <small className={tone === "orange" ? styles.negative : styles.positive}>
        {footnote}
      </small>
    </article>
  );
}

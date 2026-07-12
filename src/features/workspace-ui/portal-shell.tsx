import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";

import { Icon, type IconName } from "./ui-icons";
import { ShellControls } from "./shell/shell-controls";
import shellStyles from "./shell/shell-controls.module.css";
import styles from "./workspace-ui.module.css";

export type PortalRole = "admin" | "reviewer";
export type PortalSection =
  "dashboard" | "notas" | "validacoes" | "obras" | "logs";

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
  return (
    <div className={styles.portal}>
      <aside className={styles.side}>
        <Link href={basePath} className={styles.brandLink}>
          <PortalBrand />
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
            <PortalBrand />
          </Link>
          <ShellControls
            basePath={basePath}
            role={role}
            userEmail={userEmail}
          />
        </header>
        <main className={styles.portalContent}>{children}</main>
        <footer
          className={`${styles.portalFooter} ${shellStyles.copyrightFooter}`}
        >
          <span>
            © 2026 <strong>WinfraBR</strong>. Todos os direitos reservados.
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

function PortalBrand() {
  return (
    <span className={shellStyles.brand} aria-label="WinfraBR">
      <span className={shellStyles.brandMark}>
        <Icon name="building" />
      </span>
      <span>
        Winfra<strong>BR</strong>
      </span>
    </span>
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

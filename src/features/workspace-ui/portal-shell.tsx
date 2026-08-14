import Link from "next/link";
import type { ReactNode } from "react";

import { WinfraBrand } from "@/components/brand/winfra-brand";

import { Icon, type IconName } from "./ui-icons";
import { ShellControls } from "./shell/shell-controls";
import shellStyles from "./shell/shell-controls.module.css";
import styles from "./workspace-ui.module.css";

export type PortalRole = "admin" | "reviewer";
export type PortalSection =
  | "dashboard"
  | "notas"
  | "validacoes"
  | "historico"
  | "obras"
  | "logs";

const menu: { id: PortalSection; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "notas", label: "Notas", icon: "document" },
  { id: "historico", label: "Histórico", icon: "clock" },
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
    (item) =>
      isAdmin || !["obras", "logs", "validacoes"].includes(item.id),
  );
  const mobileMenu = visibleMenu.filter((item) =>
      isAdmin
        ? ["dashboard", "notas", "historico"].includes(item.id)
        : ["dashboard", "notas", "historico"].includes(item.id),
  );
  const adminMoreMenu = visibleMenu.filter((item) =>
    ["obras", "logs"].includes(item.id),
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
              aria-current={active === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
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

      <nav
        className={styles.mobileNav}
        aria-label="Navegação mobile"
        data-item-count={mobileMenu.length + (isAdmin ? 1 : 0)}
      >
        {mobileMenu.map((item) => (
          <Link
            key={item.id}
            href={`${basePath}${item.id === "dashboard" ? "" : `/${item.id}`}`}
            className={active === item.id ? styles.mobileActive : undefined}
            aria-current={active === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
        {isAdmin ? (
          <details className={styles.mobileMore}>
            <summary
              aria-current={
                adminMoreMenu.some((item) => item.id === active)
                  ? "page"
                  : undefined
              }
              className={
                adminMoreMenu.some((item) => item.id === active)
                  ? styles.mobileActive
                  : undefined
              }
            >
              <Icon name="more" />
              <span>Mais</span>
            </summary>
            <div className={styles.mobileMoreMenu}>
              {adminMoreMenu.map((item) => (
                <Link
                  key={item.id}
                  href={`${basePath}/${item.id}`}
                  className={active === item.id ? styles.mobileMoreActive : undefined}
                  aria-current={active === item.id ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              ))}
              <span className={styles.mobileMoreDisabled} aria-disabled="true">
                Configurações
                <small>Em breve</small>
              </span>
            </div>
          </details>
        ) : null}
      </nav>
    </div>
  );
}

function PortalBrand() {
  return <WinfraBrand className={shellStyles.brand} size={34} />;
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
      <div className={styles.metricBody}>
        <p className={styles.metricLabel}>{label}</p>
        <p className={styles.metricValue}>{value}</p>
        <p
          className={`${styles.metricFootnote} ${
            tone === "orange" ? styles.negative : styles.positive
          }`}
        >
          {footnote}
        </p>
      </div>
    </article>
  );
}

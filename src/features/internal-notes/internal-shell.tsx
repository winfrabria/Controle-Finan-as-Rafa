import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";

import styles from "./internal-notes.module.css";

type InternalShellProps = {
  activePath: "/notas" | "/validacoes";
  children: React.ReactNode;
  description: string;
  email: string;
  eyebrow: string;
  title: string;
};

export function InternalShell({
  activePath,
  children,
  description,
  email,
  eyebrow,
  title,
}: InternalShellProps) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/notas" aria-label="WinfraBR">
          <span className={styles.brandMark}>W</span>
          <span>
            Winfra<strong>BR</strong>
          </span>
        </Link>
        <nav className={styles.navigation} aria-label="Navegação principal">
          <Link
            className={activePath === "/notas" ? styles.activeNav : undefined}
            href="/notas"
          >
            <span aria-hidden="true">▤</span> Notas
          </Link>
          <Link
            className={
              activePath === "/validacoes" ? styles.activeNav : undefined
            }
            href="/validacoes"
          >
            <span aria-hidden="true">✓</span> Validações
          </Link>
          <Link href="/enviar-nota">
            <span aria-hidden="true">＋</span> Enviar nota
          </Link>
        </nav>
        <div className={styles.sidebarUser}>
          <span className={styles.avatar}>
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>Rafael</strong>
            <small>{email}</small>
          </span>
          <LogoutButton className={styles.logout} />
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.mobileHeader}>
          <Link className={styles.mobileBrand} href="/notas">
            Winfra<strong>BR</strong>
          </Link>
          <LogoutButton className={styles.mobileLogout} />
        </header>
        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <p>{eyebrow}</p>
              <h1>{title}</h1>
              <span>{description}</span>
            </div>
            <Link className={styles.uploadButton} href="/enviar-nota">
              ＋ Enviar nota
            </Link>
          </header>
          {children}
        </div>
      </main>

      <nav className={styles.mobileNav} aria-label="Navegação principal mobile">
        <Link
          className={
            activePath === "/notas" ? styles.activeMobileNav : undefined
          }
          href="/notas"
        >
          <span aria-hidden="true">▤</span>Notas
        </Link>
        <Link
          className={
            activePath === "/validacoes" ? styles.activeMobileNav : undefined
          }
          href="/validacoes"
        >
          <span aria-hidden="true">✓</span>Validações
        </Link>
        <Link href="/enviar-nota">
          <span aria-hidden="true">＋</span>Enviar
        </Link>
      </nav>
    </div>
  );
}

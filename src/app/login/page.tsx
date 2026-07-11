import type { Metadata } from "next";

import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Entrar | WinfraBR",
  description: "Acesse a área de auditoria de notas da WinfraBR.",
};

type LoginPageProps = {
  searchParams: Promise<{ next?: string; erro?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="WinfraBR">
        <div className={styles.blueprint} aria-hidden="true" />
        <div className={styles.brandContent}>
          <div className={styles.brandMark} aria-hidden="true">
            W
          </div>
          <div className={styles.brandName}>
            Winfra<span>BR</span>
          </div>
          <div className={styles.brandDivider} />
          <p>Gestão inteligente<br />de obras e contratos</p>
        </div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.card}>
          <header className={styles.header}>
            <h1>Bem-vindo de volta!</h1>
            <p>Acesse sua conta para continuar</p>
          </header>

          <LoginForm nextPath={params.next} configurationError={params.erro === "configuracao"} />

          <footer className={styles.footer}>
            © {new Date().getFullYear()} WinfraBR. Todos os direitos reservados.
          </footer>
        </div>
      </section>
    </main>
  );
}

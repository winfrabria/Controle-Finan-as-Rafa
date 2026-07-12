import type { Metadata } from "next";
import Image from "next/image";

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
      {/* ── Painel esquerdo ── */}
      <section className={styles.leftPanel}>
        {/* Logo */}
        <div className={styles.logo}>
          <svg className={styles.logoIcon} viewBox="0 0 78 44" fill="none" aria-hidden="true">
            <path d="M2 5h15l10 24L38 5h14L31 42H18L2 5Z" fill="#0A8CF0" />
            <path d="M25 5h14l10 20L60 5h16L55 42H43L25 5Z" fill="#1767E8" />
          </svg>
          <span className={styles.logoText}>
            Winfra<span className={styles.logoBr}>BR</span>
          </span>
        </div>

        {/* Headline */}
        <h1 className={styles.headline}>
          Auditoria de notas fiscais<br />
          da construção,<br />
          com precisão e{" "}
          <span className={styles.headlineBlue}>controle total.</span>
        </h1>

        {/* Subtítulo */}
        <p className={styles.subtitle}>
          A plataforma completa para auditar, validar e rastrear despesas
          de obras com segurança, transparência e inteligência.
        </p>
        <p className={styles.subtitle}>
          <span className={styles.subtitleBold}>
            Mais confiança para decidir. Mais eficiência para construir.
          </span>
        </p>

        {/* Hero image */}
        <div className={styles.heroWrap}>
          <Image
            className={styles.heroImg}
            src="/images/hero-construction.png"
            alt="Dashboard WinfraBR com laptop e cenário de construção"
            width={850}
            height={560}
            priority
          />
        </div>
      </section>

      {/* ── Painel direito ── */}
      <section className={styles.rightPanel}>
        <LoginForm
          nextPath={params.next}
          configurationError={params.erro === "configuracao"}
        />
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <div className={styles.footerItem}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>Ambiente seguro e em conformidade com a LGPD</span>
          </div>
          <div className={styles.footerSep} />
          <div className={styles.footerItem}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Seus dados estão protegidos com criptografia de ponta a ponta.</span>
          </div>
        </div>
        <div className={styles.footerRight}>
          © 2024 <span className={styles.footerBold}>WinfraBR</span>. Todos os direitos reservados.
        </div>
      </footer>
    </main>
  );
}

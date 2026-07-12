import type { Metadata } from "next";
import Image from "next/image";

import { LoginForm } from "./login/login-form";
import styles from "./login/login.module.css";

export const metadata: Metadata = {
  title: "Entrar | WinfraBR",
  description: "Acesse a área de auditoria de notas da WinfraBR.",
};

type HomePageProps = {
  searchParams: Promise<{ next?: string; erro?: string }>;
};

function LogoW() {
  return (
    <svg
      className={styles.logoSvg}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 8 L10 26 C10.5 27 11.5 27 12 26 L17 14 L20 26 C20.5 27 21.5 27 22 26 L29 8"
        stroke="#0052FF"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const configurationError = params.erro === "configuracao";
  const credentialsError = params.erro === "credenciais";

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Painel esquerdo */}
        <section className={styles.leftPanel}>
          <div className={styles.logo}>
            <LogoW />
            <span className={styles.logoText}>
              Winfra<span className={styles.logoBlue}>BR</span>
            </span>
          </div>

          <h1 className={styles.headline}>
            Auditoria de notas fiscais
            <br />
            da construção,
            <br />
            com precisão e{" "}
            <span className={styles.textBlue}>controle total.</span>
          </h1>

          <p className={styles.subtitle}>
            A plataforma completa para auditar, validar e rastrear despesas
            <br />
            de obras com segurança, transparência e inteligência.
            <br />
            Mais confiança para decidir. Mais eficiência para construir.
          </p>

          <div className={styles.heroImageContainer}>
            <Image
              src="/images/hero-construction.png"
              alt="Dashboard WinfraBR"
              width={620}
              height={400}
              priority
              className={styles.heroImg}
            />
          </div>
        </section>

        {/* Painel direito */}
        <section className={styles.rightPanel}>
          <LoginForm
            nextPath={params.next}
            configurationError={configurationError}
            credentialsError={credentialsError}
          />
        </section>
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerRight}>
          © 2026 <span className={styles.footerRightBlue}>WinfraBR</span>. Todos
          os direitos reservados.
        </div>
      </footer>
    </main>
  );
}

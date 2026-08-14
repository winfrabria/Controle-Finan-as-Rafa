import type { Metadata } from "next";

import { WinfraBrand } from "@/components/brand/winfra-brand";

import { LoginForm } from "./login/login-form";
import styles from "./login/login.module.css";

export const metadata: Metadata = {
  title: "Entrar | WinfraBR",
  description: "Acesse a área de auditoria de notas da WinfraBR.",
};

type HomePageProps = {
  searchParams: Promise<{ next?: string; erro?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const configurationError = params.erro === "configuracao";
  const credentialsError = params.erro === "credenciais";
  const callbackError = params.erro === "callback";

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.logoContainer}>
          <WinfraBrand priority size={44} />
        </div>

        <LoginForm
          nextPath={params.next}
          configurationError={configurationError}
          credentialsError={credentialsError}
          callbackError={callbackError}
        />
      </div>
    </main>
  );
}

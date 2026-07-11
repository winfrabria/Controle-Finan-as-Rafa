"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { createClient } from "@/lib/supabase/browser";
import { getSafeRedirectPath } from "@/lib/supabase/redirect";

import styles from "./login.module.css";

type LoginFormProps = {
  nextPath?: string;
  configurationError: boolean;
};

function mapAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.";
  }

  return "Não foi possível entrar agora. Tente novamente em instantes.";
}

export function LoginForm({ nextPath, configurationError }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    configurationError
      ? "A autenticação ainda não está configurada neste ambiente."
      : null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Preencha o e-mail e a senha para continuar.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(mapAuthError(authError.message));
        return;
      }

      router.replace(getSafeRedirectPath(nextPath));
      router.refresh();
    } catch {
      setError("A autenticação ainda não está configurada neste ambiente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className={styles.alert} role="alert">
          {error}
        </div>
      ) : null}

      <label className={styles.field}>
        <span>E-mail</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputIcon} aria-hidden="true">✉</span>
          <input
            autoComplete="email"
            inputMode="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="seu@email.com"
            required
            type="email"
            value={email}
            disabled={isSubmitting}
          />
        </span>
      </label>

      <label className={styles.field}>
        <span>Senha</span>
        <span className={styles.inputWrap}>
          <span className={styles.inputIcon} aria-hidden="true">⌑</span>
          <input
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Digite sua senha"
            required
            type={showPassword ? "text" : "password"}
            value={password}
            disabled={isSubmitting}
          />
          <button
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            className={styles.passwordToggle}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
            disabled={isSubmitting}
          >
            {showPassword ? "Ocultar" : "Mostrar"}
          </button>
        </span>
      </label>

      <Link className={styles.forgotLink} href="/recuperar-senha">
        Esqueci minha senha
      </Link>

      <button className={styles.submitButton} disabled={isSubmitting} type="submit">
        {isSubmitting ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {isSubmitting ? "Entrando..." : "Entrar"}
      </button>

      <div className={styles.separator}><span>ou</span></div>

      <Link className={styles.publicLink} href="/">
        <span aria-hidden="true">⇧</span>
        Ir para envio de nota
      </Link>
    </form>
  );
}

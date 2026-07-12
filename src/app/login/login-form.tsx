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

/* ── Ícones SVG ── */

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function LockBtnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
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
    <div className={styles.cardsWrap}>
      {/* ── Card: Acesso à plataforma ── */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Acesso à plataforma</h2>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {error ? (
            <div className={styles.alert} role="alert">{error}</div>
          ) : null}

          {/* E-mail */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>E-mail</span>
            <div className={styles.inputWrap}>
              <MailIcon />
              <input
                autoComplete="email"
                inputMode="email"
                name="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                type="email"
                value={email}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Senha */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Senha</span>
            <div className={styles.inputWrap}>
              <LockIcon />
              <input
                autoComplete="current-password"
                name="password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                required
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={isSubmitting}
              />
              <button
                type="button"
                className={styles.eyeToggle}
                onClick={() => setShowPassword((v) => !v)}
                disabled={isSubmitting}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {/* Botão Entrar */}
          <button
            type="submit"
            className={styles.btnEntrar}
            disabled={isSubmitting}
            id="login-submit"
          >
            {isSubmitting ? (
              <span className={styles.spinner} aria-hidden="true" />
            ) : (
              <LockBtnIcon />
            )}
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>

      {/* ── Card: Enviar nota fiscal ── */}
      <div className={styles.card}>
        <h2 className={styles.cardTitleSmall}>Enviar nota fiscal</h2>
        <Link href="/" className={styles.btnEnviar} id="public-upload-link">
          <UploadIcon />
          Enviar nota fiscal
        </Link>
      </div>
    </div>
  );
}

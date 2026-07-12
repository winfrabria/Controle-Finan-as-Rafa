"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useId, useState } from "react";

import { createClient } from "@/lib/supabase/browser";
import { getSafeRedirectPath } from "@/lib/supabase/redirect";

import styles from "./login.module.css";

const REMEMBERED_EMAIL_KEY = "winfrabr.remembered-email";

type LoginFormProps = {
  nextPath?: string;
  configurationError: boolean;
  credentialsError?: boolean;
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

function IconMail() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function IconLockBtn() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function LoginForm({
  nextPath,
  configurationError,
  credentialsError = false,
}: LoginFormProps) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    configurationError
      ? "A autenticação ainda não está configurada neste ambiente."
      : credentialsError
        ? "E-mail ou senha incorretos. Confira os dados e tente novamente."
        : null,
  );

  useEffect(() => {
    let rememberedEmail: string | null = null;

    try {
      rememberedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
    } catch {
      // O login continua funcional quando o armazenamento estiver indisponível.
    }

    if (!rememberedEmail) return;
    const emailToRemember = rememberedEmail;

    const frame = window.requestAnimationFrame(() => {
      setEmail(emailToRemember);
      setRememberEmail(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function persistRememberedEmail(normalizedEmail: string) {
    try {
      if (rememberEmail) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail);
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
    } catch {
      // Falhas de armazenamento não devem impedir a autenticação.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setError("Preencha o e-mail e a senha para continuar.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (authError) {
        setError(mapAuthError(authError.message));
        return;
      }

      persistRememberedEmail(normalizedEmail);

      router.replace(getSafeRedirectPath(nextPath));
      router.refresh();
    } catch {
      setError("A autenticação ainda não está configurada neste ambiente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.cardsWrapper}>
      {/* Card principal */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Acesso à plataforma</h2>
        <form
          action="/auth/login"
          className={styles.form}
          method="post"
          onSubmit={handleSubmit}
          noValidate
        >
          <input
            name="next"
            type="hidden"
            value={getSafeRedirectPath(nextPath)}
          />
          {error && (
            <div className={styles.alert} id={errorId} role="alert">
              {error}
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor={emailId}>E-mail</label>
            <div className={styles.inputGroup}>
              <IconMail />
              <input
                aria-describedby={error ? errorId : undefined}
                aria-invalid={Boolean(error)}
                autoComplete="email"
                id={emailId}
                inputMode="email"
                name="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                type="email"
                value={email}
                disabled={isSubmitting}
                className={styles.inputIconLeft}
              />
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor={passwordId}>Senha</label>
              <Link href="/recuperar-senha" className={styles.forgotPassword}>
                Esqueceu a senha?
              </Link>
            </div>
            <div className={styles.inputGroup}>
              <IconLock />
              <input
                aria-describedby={error ? errorId : undefined}
                aria-invalid={Boolean(error)}
                autoComplete="current-password"
                id={passwordId}
                name="password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                required
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={isSubmitting}
                className={styles.inputIconLeft}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
                disabled={isSubmitting}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>

          <label className={styles.rememberRow}>
            <input
              checked={rememberEmail}
              className={styles.checkbox}
              disabled={isSubmitting}
              onChange={(event) => setRememberEmail(event.target.checked)}
              type="checkbox"
            />
            <span>Lembrar meu login</span>
          </label>

          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <span className={styles.spinner} />
            ) : (
              <IconLockBtn />
            )}
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>

      {/* Card secundário */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Enviar nota fiscal</h2>
        <Link href="/enviar-nota" className={styles.btnOutline}>
          <IconUpload />
          <span className={styles.uploadCopy}>
            <strong>Enviar nota fiscal</strong>
            <small>Envie sua nota fiscal para análise da nossa equipe.</small>
          </span>
          <span aria-hidden="true" className={styles.uploadArrow}>
            ›
          </span>
        </Link>
      </div>
    </div>
  );
}

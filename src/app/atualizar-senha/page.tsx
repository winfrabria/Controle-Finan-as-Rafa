"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { WinfraBrand } from "@/components/brand/winfra-brand";
import { createClient } from "@/lib/supabase/browser";
import styles from "../login/login.module.css";

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconLockKeyhole() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="16" r="1" />
      <rect x="3" y="10" width="18" height="12" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="30" stroke="#10B981" strokeWidth="3" fill="#F0FDF4" />
      <path d="M20 33l8 8 16-16" stroke="#10B981" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function AtualizarSenhaPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [linkStatus, setLinkStatus] = useState<"checking" | "ready" | "invalid">(
    "checking",
  );

  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function initializeRecoverySession() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setLinkStatus(data.session ? "ready" : "invalid");
        if (data.session && (url.search || url.hash)) {
          window.history.replaceState({}, "", "/atualizar-senha");
        }
      } catch {
        if (active) setLinkStatus("invalid");
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (active && event === "PASSWORD_RECOVERY" && session) {
          setLinkStatus("ready");
        }
      },
    );
    void initializeRecoverySession();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatus("submitting");

    if (password.length < 8) {
      setErrorMessage(
        "A nova senha deve ter pelo menos 8 caracteres para ser segura.",
      );
      setStatus("error");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(
        "As senhas não conferem. Digite a mesma senha nos dois campos.",
      );
      setStatus("error");
      return;
    }

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        if (updateError.message.toLowerCase().includes("session")) {
          setErrorMessage(
            "O link expirou ou é inválido. Por favor, solicite a troca de senha novamente.",
          );
        } else {
          setErrorMessage(
            "Houve uma falha ao tentar atualizar a senha. Tente novamente.",
          );
        }
        setStatus("error");
      } else {
        setStatus("success");
      }
    } catch {
      setErrorMessage(
        "Erro de conexão. Verifique sua internet e tente novamente.",
      );
      setStatus("error");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Logo */}
        <div className={styles.logoContainer}>
          <WinfraBrand priority size={44} />
        </div>

        {/* Conteúdo */}
        <div className={styles.formContainer}>
          <div className={styles.card}>
            {linkStatus === "checking" ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <span className={styles.spinner} />
                <h1 className={styles.title} style={{ marginTop: "18px" }}>
                  Validando link seguro
                </h1>
                <p className={styles.subtitle}>Aguarde só um instante.</p>
              </div>
            ) : linkStatus === "invalid" ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <h1 className={styles.title}>Link inválido ou expirado</h1>
                <p className={styles.subtitle} style={{ marginBottom: "24px" }}>
                  Solicite um novo link de recuperação para alterar sua senha.
                </p>
                <Link href="/recuperar-senha" className={styles.btnPrimary}>
                  Solicitar novo link
                </Link>
              </div>
            ) : status === "success" ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
                  <IconCheckCircle />
                </div>
                <h1 className={styles.title} style={{ marginBottom: "10px" }}>
                  Senha atualizada!
                </h1>
                <p className={styles.subtitle} style={{ marginBottom: "28px" }}>
                  Sua nova senha foi salva com sucesso. Você já pode acessar a
                  plataforma.
                </p>
                <button
                  onClick={() => {
                    window.location.assign("/auth/landing");
                  }}
                  className={styles.btnPrimary}
                >
                  Acessar Plataforma <IconArrowRight />
                </button>
              </div>
            ) : (
              <>
                <h1 className={styles.title}>Criar nova senha</h1>
                <p className={styles.subtitle}>
                  Digite sua nova senha abaixo. Use pelo menos 8 caracteres
                  para garantir a segurança da conta.
                </p>

                <form
                  className={styles.form}
                  onSubmit={handleSubmit}
                  noValidate
                >
                  {status === "error" && errorMessage && (
                    <div className={styles.alert} role="alert">
                      {errorMessage}
                    </div>
                  )}

                  <div className={styles.field}>
                    <label>Nova senha</label>
                    <div className={styles.inputGroup}>
                      <IconLock />
                      <input
                        autoComplete="new-password"
                        name="password"
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Mínimo 8 caracteres"
                        required
                        type={showPassword ? "text" : "password"}
                        value={password}
                        disabled={status === "submitting"}
                      />
                      <button
                        type="button"
                        className={styles.eyeBtn}
                        onClick={() => setShowPassword(!showPassword)}
                        disabled={status === "submitting"}
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      >
                        {showPassword ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label>Confirmar nova senha</label>
                    <div className={styles.inputGroup}>
                      <IconLockKeyhole />
                      <input
                        autoComplete="new-password"
                        name="confirmPassword"
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a senha"
                        required
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        disabled={status === "submitting"}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={status === "submitting"}
                    style={{ marginTop: "8px" }}
                  >
                    {status === "submitting" ? (
                      <span className={styles.spinner} />
                    ) : (
                      <IconSave />
                    )}
                    {status === "submitting"
                      ? "Salvando..."
                      : "Salvar nova senha"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

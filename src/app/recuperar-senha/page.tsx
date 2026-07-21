"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { WinfraBrand } from "@/components/brand/winfra-brand";
import { createClient } from "@/lib/supabase/browser";
import styles from "../login/login.module.css";

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
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

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatus("submitting");

    if (!email.trim() || !email.includes("@")) {
      setErrorMessage("Por favor, digite um e-mail válido.");
      setStatus("error");
      return;
    }

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/atualizar-senha`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo },
      );

      if (error) {
        if (error.message.toLowerCase().includes("rate limit")) {
          setErrorMessage(
            "Muitas tentativas. Aguarde um pouco antes de tentar novamente.",
          );
        } else {
          setErrorMessage(
            "Não foi possível enviar o link de recuperação. Tente novamente mais tarde.",
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
            {status === "success" ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
                  <IconCheckCircle />
                </div>
                <h1 className={styles.title} style={{ marginBottom: "10px" }}>
                  E-mail enviado!
                </h1>
                <p className={styles.subtitle} style={{ marginBottom: "28px" }}>
                  Enviamos um link de recuperação para{" "}
                  <strong>{email}</strong>.<br />
                  Verifique sua caixa de entrada e a pasta de spam.
                </p>
                <Link href="/" className={styles.btnOutline}>
                  <IconArrowLeft /> Voltar ao login
                </Link>
              </div>
            ) : (
              <>
                <h1 className={styles.title}>Recuperar senha</h1>
                <p className={styles.subtitle}>
                  Informe seu e-mail para receber um link seguro de recuperação.
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
                    <label>E-mail</label>
                    <div className={styles.inputGroup}>
                      <IconMail />
                      <input
                        autoComplete="email"
                        inputMode="email"
                        name="email"
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="seu@email.com"
                        required
                        type="email"
                        value={email}
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
                      <IconSend />
                    )}
                    {status === "submitting"
                      ? "Enviando..."
                      : "Enviar link de recuperação"}
                  </button>

                  <Link href="/" className={styles.btnOutline} style={{ marginTop: "4px" }}>
                    <IconArrowLeft /> Voltar ao login
                  </Link>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

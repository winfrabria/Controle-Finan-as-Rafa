"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useState } from "react";

import { createClient } from "@/lib/supabase/browser";
import styles from "../login/login.module.css";

// ── SVGs Compartilhados ──
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

function IconShieldCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 11 2 2 4-4" />
    </svg>
  );
}

function IconLockKeyhole() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="16" r="1" />
      <rect x="3" y="10" width="18" height="12" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
    </svg>
  );
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

function IconSend() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#10B981"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
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
      const redirectTo = `${window.location.origin}/auth/callback?next=/atualizar-senha`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo,
        },
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
        {/* Painel Esquerdo idêntico ao Login para manter consistência UI/UX */}
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

        {/* Painel Direito com o Formulário */}
        <section className={styles.rightPanel}>
          <div className={styles.cardsWrapper}>
            <div className={styles.card}>
              {status === "success" ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      marginBottom: "20px",
                    }}
                  >
                    <IconCheckCircle />
                  </div>
                  <h2
                    className={styles.cardTitle}
                    style={{ marginBottom: "12px" }}
                  >
                    E-mail enviado!
                  </h2>
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "15px",
                      lineHeight: "1.5",
                      marginBottom: "32px",
                    }}
                  >
                    Enviamos um link de recuperação para{" "}
                    <strong>{email}</strong>. <br />
                    Verifique sua caixa de entrada e a pasta de spam.
                  </p>
                  <Link href="/" className={styles.btnOutline}>
                    <IconArrowLeft /> Voltar ao login
                  </Link>
                </div>
              ) : (
                <>
                  <h2 className={styles.cardTitle}>Recuperar senha</h2>
                  <form
                    className={styles.form}
                    onSubmit={handleSubmit}
                    noValidate
                  >
                    {status === "error" && errorMessage ? (
                      <div className={styles.alert} role="alert">
                        {errorMessage}
                      </div>
                    ) : (
                      <p
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "14px",
                          marginBottom: "8px",
                          marginTop: "-12px",
                        }}
                      >
                        Informe seu e-mail para receber um link seguro de
                        recuperação.
                      </p>
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
                          className={styles.inputIconLeft}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className={styles.btnPrimary}
                      disabled={status === "submitting"}
                      style={{ marginTop: "12px" }}
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

                    <Link
                      href="/"
                      className={styles.btnOutline}
                      style={{ marginTop: "4px" }}
                    >
                      <IconArrowLeft /> Voltar ao login
                    </Link>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <div className={styles.footerItem}>
            <IconShieldCheck />
            <span>Ambiente seguro e em conformidade com a LGPD</span>
          </div>
          <div className={styles.footerDivider} />
          <div className={styles.footerItem}>
            <IconLockKeyhole />
            <span>
              Seus dados estão protegidos com criptografia de ponta a ponta.
            </span>
          </div>
        </div>
        <div className={styles.footerRight}>
          © 2024 <span className={styles.footerRightBlue}>WinfraBR</span>.
          Todos os direitos reservados.
        </div>
      </footer>
    </main>
  );
}

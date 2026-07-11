"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { createClient } from "@/lib/supabase/browser";

import styles from "../login/login.module.css";

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/atualizar-senha`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      setMessage(
        error
          ? "Não foi possível enviar o link agora. Tente novamente."
          : "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.",
      );
    } catch {
      setMessage("A autenticação ainda não está configurada neste ambiente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="WinfraBR">
        <div className={styles.blueprint} aria-hidden="true" />
        <div className={styles.brandContent}><div className={styles.brandName}>Winfra<span>BR</span></div></div>
      </section>
      <section className={styles.formPanel}>
        <div className={styles.card}>
          <header className={styles.header}><h1>Recuperar senha</h1><p>Informe seu e-mail para receber o link de recuperação.</p></header>
          <form className={styles.form} onSubmit={handleSubmit}>
            {message ? <div className={styles.alert} role="status">{message}</div> : null}
            <label className={styles.field}><span>E-mail</span><span className={styles.inputWrap}><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></span></label>
            <button className={styles.submitButton} disabled={isSubmitting} type="submit">{isSubmitting ? "Enviando..." : "Enviar link"}</button>
            <Link className={styles.publicLink} href="/login">Voltar ao login</Link>
          </form>
        </div>
      </section>
    </main>
  );
}

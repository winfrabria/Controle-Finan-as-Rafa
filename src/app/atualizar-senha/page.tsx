"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/browser";

import styles from "../login/login.module.css";

export default function AtualizarSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("O link expirou ou não foi possível atualizar a senha.");
        return;
      }
      router.replace("/notas");
      router.refresh();
    } catch {
      setError("A autenticação ainda não está configurada neste ambiente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="WinfraBR"><div className={styles.blueprint} aria-hidden="true" /><div className={styles.brandContent}><div className={styles.brandName}>Winfra<span>BR</span></div></div></section>
      <section className={styles.formPanel}><div className={styles.card}>
        <header className={styles.header}><h1>Crie uma nova senha</h1><p>Use pelo menos 8 caracteres.</p></header>
        <form className={styles.form} onSubmit={handleSubmit}>
          {error ? <div className={styles.alert} role="alert">{error}</div> : null}
          <label className={styles.field}><span>Nova senha</span><span className={styles.inputWrap}><input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></span></label>
          <button className={styles.submitButton} disabled={isSubmitting} type="submit">{isSubmitting ? "Salvando..." : "Salvar nova senha"}</button>
        </form>
      </div></section>
    </main>
  );
}

"use client";
import Link from "next/link";
import styles from "./detail.module.css";
export default function NoteDetailError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <div className={styles.notFound}>
        <span aria-hidden="true">!</span>
        <h1>Não foi possível abrir a nota</h1>
        <p>Houve uma falha ao carregar os dados. Tente novamente.</p>
        <button className={styles.retryButton} onClick={reset} type="button">
          Tentar novamente
        </button>
        <Link href="/notas">Voltar para notas</Link>
      </div>
    </main>
  );
}

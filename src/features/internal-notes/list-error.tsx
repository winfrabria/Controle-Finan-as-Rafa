"use client";

import styles from "./internal-notes.module.css";

export function ListError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.standaloneState}>
      <div className={styles.errorState} role="alert">
        <h2>Não foi possível carregar as notas</h2>
        <p>Confira sua conexão e tente novamente. Seus filtros não foram alterados.</p>
        <button onClick={reset} type="button">Tentar novamente</button>
      </div>
    </main>
  );
}

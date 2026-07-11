import styles from "./internal-notes.module.css";

export function ListLoading() {
  return (
    <div className={styles.loadingGrid} aria-label="Carregando notas" aria-busy="true">
      <div className={styles.loadingBlock} />
      <div className={styles.loadingBlock} />
      <div className={styles.loadingBlock} />
    </div>
  );
}

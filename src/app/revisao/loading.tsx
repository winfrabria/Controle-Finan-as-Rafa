import styles from "./loading.module.css";

export default function ReviewerLoading() {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.srOnly}>Carregando conteúdo</span>
      <div className={styles.heading} />
      <div className={styles.toolbar} />
      <div className={styles.metrics}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.content} />
    </div>
  );
}

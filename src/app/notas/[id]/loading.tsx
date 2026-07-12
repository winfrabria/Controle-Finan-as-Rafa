import styles from "./detail.module.css";
export default function NoteDetailLoading() {
  return (
    <main className={styles.page}>
      <div className={styles.container} aria-label="Carregando detalhe da nota">
        <div className={styles.loadingHeader} />
        <div className={styles.summaryGrid}>
          {[1, 2, 3, 4, 5].map((item) => (
            <div className={styles.loadingCard} key={item} />
          ))}
        </div>
        <div className={styles.mainGrid}>
          {[1, 2, 3].map((item) => (
            <div className={styles.loadingPanel} key={item} />
          ))}
        </div>
      </div>
    </main>
  );
}

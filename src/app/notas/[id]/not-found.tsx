import Link from "next/link";
import styles from "./detail.module.css";
export default function NoteNotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.notFound}>
        <span aria-hidden="true">?</span>
        <h1>Nota não encontrada</h1>
        <p>Ela pode ter sido removida ou o endereço está incorreto.</p>
        <Link href="/notas">Voltar para notas</Link>
      </div>
    </main>
  );
}

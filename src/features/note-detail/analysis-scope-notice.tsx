import styles from "./analysis-scope-notice.module.css";

export function AnalysisScopeNotice({ failureMessage }: {
  assurance: { band: "HIGH" | "MEDIUM" | "LIMITED"; reason: string } | null;
  failureMessage?: string | null;
}) {
  if (failureMessage) return <section className={styles.notice} data-limited="true" aria-label="Análise não concluída">
    <header><strong>Análise não concluída</strong><span>Falha de processamento</span></header>
    <p>{failureMessage}</p>
  </section>;
  return null;
}

import { humanizeFindingText, humanizeReviewerFindingText } from "@/features/internal-notes/finding-display";
import {
  findingDocumentPageUrl, findingObservationKindLabel, formatFindingObservationAmount,
  formatFindingObservationDate, type FindingEvidenceObservation,
} from "./finding-observations";
import styles from "./finding-evidence-sources.module.css";

/** Never aggregate source rows here: the reviewer must see the exact cited values. */
export function FindingEvidenceSources({ documentUrl, observations, reviewer = true }: {
  documentUrl: string | null;
  observations: FindingEvidenceObservation[];
  reviewer?: boolean;
}) {
  const displayText = reviewer ? humanizeReviewerFindingText : humanizeFindingText;
  const renderSource = (observation: FindingEvidenceObservation, index: number) => {
    const url = findingDocumentPageUrl(documentUrl, observation.page);
    const amount = formatFindingObservationAmount(observation.amount);
    const date = formatFindingObservationDate(observation.date);
    return (
      <article className={styles.source} key={`${observation.page}-${observation.kind}-${index}`}>
        <header>
          <span className={styles.kind}>{observation.label ? displayText(observation.label) : findingObservationKindLabel(observation.kind)}</span>
          <span className={styles.page}>{observation.page ? `Página ${observation.page}` : "Página não identificada"}</span>
        </header>
        {observation.value || amount || date ? <dl className={styles.values}>
          {observation.value ? <div><dt>Conteúdo comparado</dt><dd>{displayText(observation.value)}</dd></div> : null}
          {amount ? <div><dt>Valor registrado</dt><dd>{amount}</dd></div> : null}
          {date ? <div><dt>Data registrada</dt><dd>{date}</dd></div> : null}
        </dl> : null}
        {observation.text ? <blockquote>{displayText(observation.text)}</blockquote> : null}
        {url ? <a href={url} rel="noreferrer" target="_blank">
          {observation.page ? `Conferir na página ${observation.page}` : "Conferir no documento"}
          <span aria-hidden="true"> ↗</span><span className={styles.srOnly}> (abre em nova aba)</span>
        </a> : null}
      </article>
    );
  };
  return <div className={styles.sources}>
    {observations.slice(0, 4).map(renderSource)}
    {observations.length > 4 ? <details className={styles.more}>
      <summary>Ver mais {observations.length - 4} registros de evidência</summary>
      <div className={styles.sources}>{observations.slice(4).map(renderSource)}</div>
    </details> : null}
  </div>;
}

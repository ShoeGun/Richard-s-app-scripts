import type { CatalogEntry } from '../lib/data-catalog';

interface DataCatalogProps {
  entries: CatalogEntry[];
  onLoadBundled: () => void;
  loading: boolean;
}

export function DataCatalog({ entries, onLoadBundled, loading }: DataCatalogProps) {
  return (
    <section id="data-catalog" className="section catalog-panel" aria-labelledby="catalog-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">OPEN DATA</p>
          <h2 id="catalog-title">Dataset catalog</h2>
        </div>
        <p>Inspect a bundled sample or follow an attributed public source. External data is never fetched automatically.</p>
      </div>

      <div className="catalog-grid">
        {entries.map((entry) => (
          <article className="catalog-entry" key={entry.id}>
            <div className="catalog-meta">
              <span>{entry.origin}</span>
              <span>{entry.format.toUpperCase()}</span>
            </div>
            <h3>{entry.title}</h3>
            <p>{entry.description}</p>
            <p className="catalog-publisher">Published by {entry.publisher}</p>
            <h4>Questions to explore</h4>
            <ul>
              {entry.suggestedQuestions.map((question) => <li key={question}>{question}</li>)}
            </ul>
            <div className="catalog-actions">
              {entry.origin === 'bundled' ? (
                <button type="button" onClick={onLoadBundled} disabled={loading}>
                  {loading ? 'Loading dataset' : 'Load bundled data'}
                </button>
              ) : (
                <a href={entry.datasetUrl} target="_blank" rel="noreferrer">Open dataset</a>
              )}
              <a href={entry.sourcePageUrl} target="_blank" rel="noreferrer">Source details</a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

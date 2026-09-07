export type CatalogOrigin = 'bundled' | 'external';
export type CatalogFormat = 'csv' | 'json';

export interface CatalogEntry {
  id: string;
  title: string;
  publisher: string;
  description: string;
  format: CatalogFormat;
  sourcePageUrl: string;
  datasetUrl: string;
  origin: CatalogOrigin;
  suggestedQuestions: string[];
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);

export function bundledDatasetUrl(
  baseUrl = import.meta.env.BASE_URL,
  origin = window.location.origin
) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`${normalizedBase}data/demo.csv`, origin).href;
}

export function createDataCatalog(
  baseUrl = import.meta.env.BASE_URL,
  origin = window.location.origin
): CatalogEntry[] {
  return [
    {
      id: 'portfolio-demo',
      title: 'Portfolio project demo',
      publisher: 'Richard Jones',
      description: 'A small bundled dataset for a fast, offline-first analytics demonstration.',
      format: 'csv',
      sourcePageUrl: new URL(baseUrl, origin).href,
      datasetUrl: bundledDatasetUrl(baseUrl, origin),
      origin: 'bundled',
      suggestedQuestions: [
        'Count projects by category.',
        'Find the average score by category.',
        'Sort categories by total project count.'
      ]
    },
    {
      id: 'vega-cars',
      title: 'Automobile performance',
      publisher: 'Vega datasets',
      description: 'Fuel economy, horsepower, weight, origin, and model-year observations.',
      format: 'json',
      sourcePageUrl: 'https://github.com/vega/vega-datasets/blob/main/data/cars.json',
      datasetUrl: 'https://cdn.jsdelivr.net/npm/vega-datasets@3/data/cars.json',
      origin: 'external',
      suggestedQuestions: [
        'Compare average horsepower by origin.',
        'Count vehicles by model year.',
        'Sort origins by average fuel economy.'
      ]
    },
    {
      id: 'vega-seattle-weather',
      title: 'Seattle daily weather',
      publisher: 'Vega datasets',
      description: 'Daily precipitation, temperature, wind, and weather labels for Seattle.',
      format: 'csv',
      sourcePageUrl: 'https://github.com/vega/vega-datasets/blob/main/data/seattle-weather.csv',
      datasetUrl: 'https://cdn.jsdelivr.net/npm/vega-datasets@3/data/seattle-weather.csv',
      origin: 'external',
      suggestedQuestions: [
        'Count days by weather type.',
        'Compare average precipitation by weather type.',
        'Sort weather types by average wind speed.'
      ]
    }
  ];
}

export function validateCatalog(entries: CatalogEntry[]) {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`Catalog id must be unique: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.title || !entry.publisher || !entry.description) {
      throw new Error(`Catalog entry ${entry.id} is missing attribution or description.`);
    }
    if (!['csv', 'json'].includes(entry.format)) {
      throw new Error(`Catalog entry ${entry.id} uses unsupported format ${entry.format}.`);
    }
    if (entry.suggestedQuestions.length < 2 || entry.suggestedQuestions.some((item) => !item.trim())) {
      throw new Error(`Catalog entry ${entry.id} needs at least two suggested questions.`);
    }
    for (const [label, value] of [
      ['source', entry.sourcePageUrl],
      ['dataset', entry.datasetUrl]
    ] as const) {
      const url = new URL(value);
      if (entry.origin === 'external' && loopbackHosts.has(url.hostname)) {
        throw new Error(`Catalog entry ${entry.id} has a loopback ${label} URL.`);
      }
      if (entry.origin === 'external' && url.protocol !== 'https:') {
        throw new Error(`Catalog entry ${entry.id} requires an HTTPS ${label} URL.`);
      }
    }
  }
  return entries;
}

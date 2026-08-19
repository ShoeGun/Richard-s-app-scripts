import { describe, expect, it } from 'vitest';

import { bundledDatasetUrl, createDataCatalog, validateCatalog } from './data-catalog';

describe('data catalog', () => {
  it('resolves bundled data beneath a GitHub Pages project path', () => {
    expect(bundledDatasetUrl('/ShoeGun.github.io/', 'https://shoegun.github.io')).toBe(
      'https://shoegun.github.io/ShoeGun.github.io/data/demo.csv'
    );
  });

  it('accepts the curated production catalog', () => {
    const entries = createDataCatalog('/ShoeGun.github.io/', 'https://shoegun.github.io');
    expect(validateCatalog(entries)).toHaveLength(3);
    expect(entries.every((entry) => !entry.datasetUrl.includes('localhost'))).toBe(true);
  });

  it('rejects loopback and insecure external URLs', () => {
    const [bundled, external] = createDataCatalog('/', 'https://shoegun.github.io');
    expect(() => validateCatalog([
      bundled,
      { ...external, datasetUrl: 'http://localhost/data.json' }
    ])).toThrow(/loopback|https/i);
    expect(() => validateCatalog([
      bundled,
      { ...external, datasetUrl: 'http://example.com/data.json' }
    ])).toThrow(/https/i);
  });
});

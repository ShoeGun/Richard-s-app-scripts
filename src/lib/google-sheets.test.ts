import { describe, expect, it, vi } from 'vitest';

import { fetchGoogleSheet, parseGoogleSheetUrl } from './google-sheets';

describe('parseGoogleSheetUrl', () => {
  it('creates a CSV endpoint from an edit link', () => {
    const reference = parseGoogleSheetUrl(
      'https://docs.google.com/spreadsheets/d/abc_123/edit#gid=42'
    );
    expect(reference.spreadsheetId).toBe('abc_123');
    expect(reference.gid).toBe('42');
    expect(reference.csvUrl).toContain('gid=42');
  });

  it('rejects non-Google links', () => {
    expect(() => parseGoogleSheetUrl('https://example.com/sheet')).toThrow(/docs.google.com/);
  });

  it('returns a browser-local dataset from a readable CSV response', async () => {
    const fetchMock = vi.fn(async () => new Response('name,score\nAda,10', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit')).resolves.toMatchObject({
      fileName: 'google-sheet-abc123.csv',
      format: 'csv',
      content: 'name,score\nAda,10'
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&gid=0',
      { mode: 'cors' }
    );
    vi.unstubAllGlobals();
  });
});

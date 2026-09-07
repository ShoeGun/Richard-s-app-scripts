import { describe, expect, it } from 'vitest';

import { readUploadedDataset } from './upload';

describe('readUploadedDataset', () => {
  it('accepts CSV without uploading or transforming its contents', async () => {
    const result = await readUploadedDataset(new File(['name,score\nAda,10'], 'people.csv'));
    expect(result).toEqual({
      fileName: 'people.csv',
      format: 'csv',
      content: 'name,score\nAda,10'
    });
  });

  it('normalizes a single JSON object to rows', async () => {
    const result = await readUploadedDataset(new File(['{"name":"Ada"}'], 'person.json'));
    expect(result.content).toBe('[{"name":"Ada"}]');
  });

  it('rejects malformed and unsupported files', async () => {
    await expect(readUploadedDataset(new File(['{'], 'bad.json'))).rejects.toThrow(/not valid json/i);
    await expect(readUploadedDataset(new File(['x'], 'notes.txt'))).rejects.toThrow(/supports csv and json/i);
  });
});

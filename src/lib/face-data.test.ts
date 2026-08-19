import { describe, expect, it } from 'vitest';
import { faceDataFromAnalysis } from './face-data';

describe('face data', () => {
  it('turns numeric analysis results into bounded face signals', () => {
    const signal = faceDataFromAnalysis({
      rows: [
        { category: 'A', count: 2 },
        { category: 'B', count: 8 },
        { category: 'C', count: 4 }
      ],
      chart: { type: 'bar', x: 'category', y: 'count' }
    });
    expect(signal.eyes).toHaveLength(2);
    expect(signal.mouth).toHaveLength(3);
    expect(signal.eyes.every((value) => value >= 2 && value <= 18)).toBe(true);
    expect(signal.label).toContain('3 result rows');
  });
});

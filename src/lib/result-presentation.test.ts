import { describe, expect, it } from 'vitest';

import { deriveChartSeries, summarizeAnalysisResult } from './result-presentation';
import type { AnalysisResult } from './deterministic-analysis';

const result = (type: 'table' | 'bar' | 'line' | 'scatter'): AnalysisResult => ({
  rows: [
    { category: 'web', projects: 2 },
    { category: 'ai', projects: 5 }
  ],
  chart: type === 'table'
    ? { type }
    : { type, x: 'category', y: 'projects' }
});

describe('result presentation', () => {
  it.each(['bar', 'line', 'scatter'] as const)('derives grounded %s chart points', (type) => {
    expect(deriveChartSeries(result(type))).toEqual({
      type,
      xField: 'category',
      yField: 'projects',
      points: [
        { label: 'web', x: 0, y: 2 },
        { label: 'ai', x: 1, y: 5 }
      ],
      minY: 0,
      maxY: 5
    });
  });

  it('returns no series for table results and summarizes only result values', () => {
    expect(deriveChartSeries(result('table'))).toBeNull();
    expect(summarizeAnalysisResult(result('bar')))
      .toBe('2 rows returned. Bar chart plots projects by category. ai has the highest projects at 5.');
    expect(summarizeAnalysisResult(result('table')))
      .toBe('2 rows returned. Table view selected.');
  });

  it('handles empty results without inventing an explanation', () => {
    expect(summarizeAnalysisResult({
      rows: [],
      chart: { type: 'bar', x: 'category', y: 'projects' }
    })).toBe('No result rows returned.');
  });
});

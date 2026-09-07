import { describe, expect, it } from 'vitest';

import {
  AnalysisPlanError,
  executeAnalysis,
  type AnalysisRow
} from './deterministic-analysis';

const demoRows: AnalysisRow[] = [
  { project: 'Portfolio', category: 'web', year: 2025, score: 8 },
  { project: 'Agentic OS', category: 'ai', year: 2026, score: 10 },
  { project: 'Voice Platform', category: 'ai', year: 2026, score: 6 },
  { project: 'Archive', category: 'web', year: 2024, score: 2 }
];

describe('executeAnalysis', () => {
  it('filters, groups, aggregates, sorts, limits, and chooses a chart deterministically', () => {
    const result = executeAnalysis(demoRows, {
      filters: [{ field: 'year', operator: 'gte', value: 2025 }],
      groupBy: ['category'],
      aggregations: [
        { operator: 'count', as: 'projects' },
        { operator: 'avg', field: 'score', as: 'average_score' }
      ],
      sort: [{ field: 'average_score', direction: 'desc' }],
      limit: 2,
      chart: { type: 'auto' }
    });

    expect(result.rows).toEqual([
      { category: 'web', projects: 1, average_score: 8 },
      { category: 'ai', projects: 2, average_score: 8 }
    ]);
    expect(result.chart).toEqual({ type: 'bar', x: 'category', y: 'projects' });
  });

  it('supports explicit chart selection for included data', () => {
    const result = executeAnalysis(demoRows, {
      filters: [{ field: 'project', operator: 'contains', value: 'platform' }],
      chart: { type: 'bar', x: 'project', y: 'score' }
    });

    expect(result.rows).toEqual([
      { project: 'Voice Platform', category: 'ai', year: 2026, score: 6 }
    ]);
    expect(result.chart.type).toBe('bar');
  });

  it('rejects unsupported operations and unknown fields', () => {
    expect(() => executeAnalysis(demoRows, {
      filters: [{ field: 'year', operator: 'regex' as 'eq', value: '.*' }]
    })).toThrow(AnalysisPlanError);

    expect(() => executeAnalysis(demoRows, {
      aggregations: [{ operator: 'sum', field: 'missing', as: 'total' }]
    })).toThrow('not present in the dataset');
  });

  it('rejects unsafe limits and non-numeric aggregate inputs', () => {
    expect(() => executeAnalysis(demoRows, { limit: 0 })).toThrow('Limit');
    expect(() => executeAnalysis(demoRows, {
      aggregations: [{ operator: 'avg', field: 'project', as: 'average' }]
    })).toThrow('must contain only finite numbers');
  });
});

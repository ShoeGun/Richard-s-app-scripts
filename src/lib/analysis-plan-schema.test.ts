import { describe, expect, it } from 'vitest';

import {
  AnalysisPlanSchema,
  AnalysisPlanValidationError,
  validateAnalysisPlan
} from './analysis-plan-schema';

const validPlan = {
  filters: [{ field: 'year', operator: 'gte', value: 2025 }],
  groupBy: ['category'],
  aggregations: [
    { operator: 'count', as: 'projects' },
    { operator: 'avg', field: 'score', as: 'average_score' }
  ],
  sort: [{ field: 'average_score', direction: 'desc' }],
  limit: 10,
  chart: { type: 'bar', x: 'category', y: 'projects' }
} as const;

describe('AnalysisPlanSchema', () => {
  it('validates a supported analysis plan', () => {
    expect(validateAnalysisPlan(validPlan)).toEqual(validPlan);
  });

  it.each([
    ['unknown operation', { filters: [{ field: 'year', operator: 'execute', value: 1 }] }],
    ['unknown plan key', { ...validPlan, command: 'delete everything' }],
    ['non-finite value', { filters: [{ field: 'score', operator: 'gt', value: Infinity }] }],
    ['invalid limit', { limit: 1001 }],
    ['missing aggregation field', { aggregations: [{ operator: 'sum', as: 'total' }] }],
    ['oversized field name', { groupBy: ['x'.repeat(129)] }],
    ['too many steps', { groupBy: Array.from({ length: 33 }, (_, index) => `field_${index}`) }]
  ])('rejects %s', (_label, input) => {
    expect(AnalysisPlanSchema.safeParse(input).success).toBe(false);
  });

  it('returns compact, structured validation issues', () => {
    expect(() =>
      validateAnalysisPlan({
        aggregations: [{ operator: 'avg', as: '' }],
        limit: 0
      })
    ).toThrow(AnalysisPlanValidationError);

    try {
      validateAnalysisPlan({ limit: 0 });
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisPlanValidationError);
      expect((error as AnalysisPlanValidationError).issues).toEqual([
        expect.objectContaining({ path: 'limit' })
      ]);
    }
  });
});

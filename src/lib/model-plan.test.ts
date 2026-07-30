import { describe, expect, it } from 'vitest';

import { ModelPlanError, parseModelPlan } from './model-plan';

describe('parseModelPlan', () => {
  it('accepts a supported JSON plan, including a fenced response', () => {
    expect(parseModelPlan(`\`\`\`json
      {
        "groupBy": ["category"],
        "aggregations": [{"operator": "count", "as": "projects"}],
        "chart": {"type": "bar", "x": "category", "y": "projects"}
      }
    \`\`\``)).toEqual({
      groupBy: ['category'],
      aggregations: [{ operator: 'count', as: 'projects' }],
      chart: { type: 'bar', x: 'category', y: 'projects' }
    });
  });

  it('extracts one JSON object from harmless surrounding model commentary', () => {
    expect(parseModelPlan(
      'Here is the plan: {"filters":[{"field":"year","operator":"gte","value":2025}]}'
    )).toEqual({
      filters: [{ field: 'year', operator: 'gte', value: 2025 }]
    });
  });

  it('rejects malformed model output with a safe error', () => {
    expect(() => parseModelPlan('Try grouping by category.')).toThrow(ModelPlanError);
  });

  it('rejects raw SQL and unknown executable fields', () => {
    expect(() => parseModelPlan(JSON.stringify({
      sql: 'DROP TABLE demo',
      limit: 10
    }))).toThrow(/unsupported plan/i);
  });
});

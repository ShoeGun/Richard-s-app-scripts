import {
  AnalysisPlanValidationError,
  validateAnalysisPlan,
  type StructuredAnalysisPlan
} from './analysis-plan-schema';

export class ModelPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelPlanError';
  }
}

function unwrapJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace
    ? trimmed.slice(firstBrace, lastBrace + 1)
    : trimmed;
}

const filterOperators: Record<string, string> = {
  equals: 'eq',
  equal: 'eq',
  not_equals: 'neq',
  'not-equals': 'neq',
  greater_than: 'gt',
  'greater-than': 'gt',
  greater_than_or_equal: 'gte',
  'greater-than-or-equal': 'gte',
  less_than: 'lt',
  'less-than': 'lt',
  less_than_or_equal: 'lte',
  'less-than-or-equal': 'lte',
  includes: 'contains'
};

function normalizePlanCandidate(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  const plan = { ...(candidate as Record<string, unknown>) };

  if (typeof plan.groupBy === 'string') plan.groupBy = [plan.groupBy];
  if (typeof plan.limit === 'string' && /^\d+$/.test(plan.limit)) plan.limit = Number(plan.limit);

  if (Array.isArray(plan.filters)) {
    plan.filters = plan.filters.flatMap((filter) => {
      if (!filter || typeof filter !== 'object') return [];
      const item = { ...(filter as Record<string, unknown>) };
      if (typeof item.operator === 'string') item.operator = filterOperators[item.operator] || item.operator;
      return typeof item.field === 'string' && typeof item.operator === 'string' && 'value' in item ? [item] : [];
    });
  } else if (plan.filters !== undefined) {
    delete plan.filters;
  }

  if (Array.isArray(plan.sort)) {
    plan.sort = plan.sort.flatMap((sort) => {
      if (!sort || typeof sort !== 'object') return [];
      const item = { ...(sort as Record<string, unknown>) };
      if (typeof item.direction === 'string') {
        item.direction = {
          ascending: 'asc',
          increasing: 'asc',
          'a-z': 'asc',
          descending: 'desc',
          decreasing: 'desc',
          'z-a': 'desc'
        }[item.direction.toLowerCase()] || item.direction.toLowerCase();
      }
      return typeof item.field === 'string' && (item.direction === 'asc' || item.direction === 'desc') ? [item] : [];
    });
  } else if (plan.sort !== undefined) {
    delete plan.sort;
  }

  if (plan.chart && typeof plan.chart === 'object' && !Array.isArray(plan.chart)) {
    const chart = { ...(plan.chart as Record<string, unknown>) };
    if (chart.type === 'column' || chart.type === 'column chart') chart.type = 'bar';
    plan.chart = chart;
  }

  return plan;
}

export function parseModelPlan(raw: string): StructuredAnalysisPlan {
  let candidate: unknown;
  try {
    candidate = JSON.parse(unwrapJson(raw));
  } catch {
    throw new ModelPlanError('The local model did not return a valid JSON analysis plan.');
  }

  try {
    return validateAnalysisPlan(normalizePlanCandidate(candidate));
  } catch (error) {
    if (error instanceof AnalysisPlanValidationError) {
      const detail = error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path || 'plan'}: ${issue.message}`)
        .join('; ');
      throw new ModelPlanError(`The local model returned an unsupported plan. ${detail}`);
    }
    throw error;
  }
}

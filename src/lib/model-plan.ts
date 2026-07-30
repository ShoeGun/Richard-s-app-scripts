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

export function parseModelPlan(raw: string): StructuredAnalysisPlan {
  let candidate: unknown;
  try {
    candidate = JSON.parse(unwrapJson(raw));
  } catch {
    throw new ModelPlanError('The local model did not return a valid JSON analysis plan.');
  }

  try {
    return validateAnalysisPlan(candidate);
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

import { z } from 'zod';

const FIELD_NAME_MAX_LENGTH = 128;
const OUTPUT_NAME_MAX_LENGTH = 128;
const MAX_STEPS_PER_KIND = 32;

const fieldNameSchema = z.string().trim().min(1).max(FIELD_NAME_MAX_LENGTH);
const analysisValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

export const AnalysisFilterSchema = z
  .object({
    field: fieldNameSchema,
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']),
    value: analysisValueSchema
  })
  .strict();

export const AnalysisAggregationSchema = z
  .object({
    operator: z.enum(['count', 'sum', 'avg', 'min', 'max']),
    field: fieldNameSchema.optional(),
    as: z.string().trim().min(1).max(OUTPUT_NAME_MAX_LENGTH)
  })
  .strict()
  .superRefine((aggregation, context) => {
    if (aggregation.operator !== 'count' && !aggregation.field) {
      context.addIssue({
        code: 'custom',
        path: ['field'],
        message: `${aggregation.operator} requires a field`
      });
    }
  });

export const AnalysisSortSchema = z
  .object({
    field: fieldNameSchema,
    direction: z.enum(['asc', 'desc'])
  })
  .strict();

export const AnalysisChartSchema = z
  .object({
    type: z.enum(['auto', 'table', 'bar', 'line', 'scatter']),
    x: fieldNameSchema.optional(),
    y: fieldNameSchema.optional()
  })
  .strict();

export const AnalysisPlanSchema = z
  .object({
    filters: z.array(AnalysisFilterSchema).max(MAX_STEPS_PER_KIND).optional(),
    groupBy: z.array(fieldNameSchema).max(MAX_STEPS_PER_KIND).optional(),
    aggregations: z
      .array(AnalysisAggregationSchema)
      .max(MAX_STEPS_PER_KIND)
      .optional(),
    sort: z.array(AnalysisSortSchema).max(MAX_STEPS_PER_KIND).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    chart: AnalysisChartSchema.optional()
  })
  .strict();

export type StructuredAnalysisPlan = z.infer<typeof AnalysisPlanSchema>;

export interface AnalysisPlanValidationIssue {
  path: string;
  message: string;
}

export class AnalysisPlanValidationError extends Error {
  readonly issues: AnalysisPlanValidationIssue[];

  constructor(issues: AnalysisPlanValidationIssue[]) {
    super('Analysis plan validation failed');
    this.name = 'AnalysisPlanValidationError';
    this.issues = issues;
  }
}

export function validateAnalysisPlan(input: unknown): StructuredAnalysisPlan {
  const result = AnalysisPlanSchema.safeParse(input);
  if (result.success) return result.data;

  throw new AnalysisPlanValidationError(
    result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  );
}

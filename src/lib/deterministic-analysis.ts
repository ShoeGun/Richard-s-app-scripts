export type AnalysisValue = string | number | boolean | null;
export type AnalysisRow = Record<string, AnalysisValue>;

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

export interface AnalysisFilter {
  field: string;
  operator: FilterOperator;
  value: AnalysisValue;
}

export type AggregationOperator = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AnalysisAggregation {
  operator: AggregationOperator;
  field?: string;
  as: string;
}

export interface AnalysisSort {
  field: string;
  direction: 'asc' | 'desc';
}

export type ChartType = 'table' | 'bar' | 'line' | 'scatter';

export interface ChartRequest {
  type: ChartType | 'auto';
  x?: string;
  y?: string;
}

export interface AnalysisPlan {
  filters?: AnalysisFilter[];
  groupBy?: string[];
  aggregations?: AnalysisAggregation[];
  sort?: AnalysisSort[];
  limit?: number;
  chart?: ChartRequest;
}

export interface ChartSelection {
  type: ChartType;
  x?: string;
  y?: string;
}

export interface AnalysisResult {
  rows: AnalysisRow[];
  chart: ChartSelection;
}

const FILTER_OPERATORS = new Set<FilterOperator>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains'
]);
const AGGREGATION_OPERATORS = new Set<AggregationOperator>([
  'count',
  'sum',
  'avg',
  'min',
  'max'
]);
const CHART_TYPES = new Set<ChartType | 'auto'>([
  'auto',
  'table',
  'bar',
  'line',
  'scatter'
]);

export class AnalysisPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisPlanError';
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new AnalysisPlanError(`${label} must be a simple field identifier.`);
  }
}

function assertKnownField(field: string, fields: Set<string>, label = 'Field') {
  assertIdentifier(field, label);
  if (!fields.has(field)) {
    throw new AnalysisPlanError(`${label} "${field}" is not present in the dataset.`);
  }
}

function assertValue(value: unknown, label: string): asserts value is AnalysisValue {
  if (
    value !== null
    && typeof value !== 'string'
    && typeof value !== 'boolean'
    && (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new AnalysisPlanError(`${label} must be a string, finite number, boolean, or null.`);
  }
}

function compareValues(left: AnalysisValue, right: AnalysisValue) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matchesFilter(row: AnalysisRow, filter: AnalysisFilter) {
  const actual = row[filter.field];
  switch (filter.operator) {
    case 'eq':
      return actual === filter.value;
    case 'neq':
      return actual !== filter.value;
    case 'gt':
      return compareValues(actual, filter.value) > 0;
    case 'gte':
      return compareValues(actual, filter.value) >= 0;
    case 'lt':
      return compareValues(actual, filter.value) < 0;
    case 'lte':
      return compareValues(actual, filter.value) <= 0;
    case 'contains':
      return typeof actual === 'string'
        && typeof filter.value === 'string'
        && actual.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
  }
}

function numericValues(rows: AnalysisRow[], field: string) {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length !== rows.length) {
    throw new AnalysisPlanError(`Aggregation field "${field}" must contain only finite numbers.`);
  }
  return values;
}

function aggregate(rows: AnalysisRow[], operation: AnalysisAggregation): AnalysisValue {
  if (operation.operator === 'count') return rows.length;
  const values = numericValues(rows, operation.field as string);
  if (values.length === 0) return null;

  switch (operation.operator) {
    case 'sum':
      return values.reduce((total, value) => total + value, 0);
    case 'avg':
      return values.reduce((total, value) => total + value, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
  }
}

function groupRows(rows: AnalysisRow[], fields: string[]) {
  const groups = new Map<string, AnalysisRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(fields.map((field) => row[field]));
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups.values();
}

function outputFields(
  sourceFields: Set<string>,
  groupBy: string[],
  aggregations: AnalysisAggregation[]
) {
  if (aggregations.length === 0) return sourceFields;
  return new Set([...groupBy, ...aggregations.map((operation) => operation.as)]);
}

function selectChart(
  rows: AnalysisRow[],
  request: ChartRequest | undefined,
  groupBy: string[],
  aggregations: AnalysisAggregation[]
): ChartSelection {
  const fields = new Set(rows.flatMap((row) => Object.keys(row)));
  const requestedType = request?.type ?? 'auto';

  if (!CHART_TYPES.has(requestedType)) {
    throw new AnalysisPlanError(`Unsupported chart type "${String(requestedType)}".`);
  }
  if (requestedType !== 'auto') {
    if (requestedType === 'table') return { type: 'table' };
    if (!request?.x || !request.y) {
      throw new AnalysisPlanError(`${requestedType} charts require x and y fields.`);
    }
    assertKnownField(request.x, fields, 'Chart x field');
    assertKnownField(request.y, fields, 'Chart y field');
    if (!rows.every((row) => typeof row[request.y as string] === 'number')) {
      throw new AnalysisPlanError(`Chart y field "${request.y}" must be numeric.`);
    }
    return { type: requestedType, x: request.x, y: request.y };
  }

  const numericField = [...fields].find((field) =>
    rows.length > 0 && rows.every((row) => typeof row[field] === 'number')
  );
  if (groupBy[0] && aggregations[0] && numericField) {
    return { type: 'bar', x: groupBy[0], y: aggregations[0].as };
  }
  return { type: 'table' };
}

export function executeAnalysis(inputRows: AnalysisRow[], plan: AnalysisPlan): AnalysisResult {
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    throw new AnalysisPlanError('The dataset must contain at least one row.');
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new AnalysisPlanError('Analysis plan must be an object.');
  }

  const sourceFields = new Set(Object.keys(inputRows[0]));
  for (const [index, row] of inputRows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new AnalysisPlanError(`Dataset row ${index} must be an object.`);
    }
    for (const field of sourceFields) {
      if (!(field in row)) throw new AnalysisPlanError(`Dataset row ${index} is missing "${field}".`);
      assertValue(row[field], `Dataset value ${index}.${field}`);
    }
  }

  const filters = plan.filters ?? [];
  const groupBy = plan.groupBy ?? [];
  const aggregations = plan.aggregations ?? [];
  const sort = plan.sort ?? [];
  const limit = plan.limit ?? 100;

  if (!Array.isArray(filters) || !Array.isArray(groupBy) || !Array.isArray(aggregations) || !Array.isArray(sort)) {
    throw new AnalysisPlanError('Filters, groupBy, aggregations, and sort must be arrays.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new AnalysisPlanError('Limit must be an integer from 1 through 1000.');
  }

  for (const filter of filters) {
    assertKnownField(filter.field, sourceFields, 'Filter field');
    if (!FILTER_OPERATORS.has(filter.operator)) {
      throw new AnalysisPlanError(`Unsupported filter operator "${String(filter.operator)}".`);
    }
    assertValue(filter.value, `Filter value for "${filter.field}"`);
  }
  for (const field of groupBy) assertKnownField(field, sourceFields, 'Group field');
  if (new Set(groupBy).size !== groupBy.length) {
    throw new AnalysisPlanError('Group fields must be unique.');
  }
  for (const operation of aggregations) {
    if (!AGGREGATION_OPERATORS.has(operation.operator)) {
      throw new AnalysisPlanError(`Unsupported aggregation "${String(operation.operator)}".`);
    }
    assertIdentifier(operation.as, 'Aggregation alias');
    if (sourceFields.has(operation.as) || groupBy.includes(operation.as)) {
      throw new AnalysisPlanError(`Aggregation alias "${operation.as}" conflicts with a dataset field.`);
    }
    if (operation.operator !== 'count') {
      if (!operation.field) throw new AnalysisPlanError(`${operation.operator} requires a field.`);
      assertKnownField(operation.field, sourceFields, 'Aggregation field');
    }
  }
  if (new Set(aggregations.map((operation) => operation.as)).size !== aggregations.length) {
    throw new AnalysisPlanError('Aggregation aliases must be unique.');
  }

  const filtered = inputRows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
  let rows: AnalysisRow[];
  if (aggregations.length > 0) {
    const groups = groupBy.length > 0 ? groupRows(filtered, groupBy) : [filtered].values();
    rows = [...groups].map((group) => {
      const first = group[0];
      const output: AnalysisRow = {};
      for (const field of groupBy) output[field] = first[field];
      for (const operation of aggregations) output[operation.as] = aggregate(group, operation);
      return output;
    });
  } else {
    rows = filtered.map((row) => ({ ...row }));
  }

  const sortableFields = outputFields(sourceFields, groupBy, aggregations);
  for (const item of sort) {
    assertKnownField(item.field, sortableFields, 'Sort field');
    if (item.direction !== 'asc' && item.direction !== 'desc') {
      throw new AnalysisPlanError(`Unsupported sort direction "${String(item.direction)}".`);
    }
  }
  rows.sort((left, right) => {
    for (const item of sort) {
      const comparison = compareValues(left[item.field], right[item.field]);
      if (comparison !== 0) return item.direction === 'asc' ? comparison : -comparison;
    }
    return 0;
  });
  rows = rows.slice(0, limit);

  return {
    rows,
    chart: selectChart(rows, plan.chart, groupBy, aggregations)
  };
}

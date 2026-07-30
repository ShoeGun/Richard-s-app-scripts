import type { StructuredAnalysisPlan } from '../lib/analysis-plan-schema';
import type { AnalysisResult } from '../lib/deterministic-analysis';

export type AnalyticsErrorCode =
  | 'INITIALIZATION_FAILED'
  | 'DATASET_LOAD_FAILED'
  | 'SCHEMA_INSPECTION_FAILED'
  | 'PLAN_VALIDATION_FAILED'
  | 'PLAN_EXECUTION_FAILED'
  | 'INVALID_REQUEST';

export interface AnalyticsError {
  code: AnalyticsErrorCode;
  message: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface InitializeRequest {
  type: 'initialize';
  requestId: string;
}

export interface LoadDatasetRequest {
  type: 'load-dataset';
  requestId: string;
  datasetUrl?: string;
}

export interface InspectSchemaRequest {
  type: 'inspect-schema';
  requestId: string;
}

export interface ExecutePlanRequest {
  type: 'execute-plan';
  requestId: string;
  plan: StructuredAnalysisPlan;
}

export type AnalyticsRequest =
  | InitializeRequest
  | LoadDatasetRequest
  | InspectSchemaRequest
  | ExecutePlanRequest;

export interface InitializedResponse {
  type: 'initialized';
  requestId: string;
  ok: true;
}

export interface DatasetLoadedResponse {
  type: 'dataset-loaded';
  requestId: string;
  ok: true;
}

export interface SchemaInspectedResponse {
  type: 'schema-inspected';
  requestId: string;
  ok: true;
  schema: SchemaColumn[];
}

export interface AnalysisExecutedResponse {
  type: 'analysis-executed';
  requestId: string;
  ok: true;
  result: AnalysisResult;
}

export interface AnalyticsErrorResponse {
  type: 'analytics-error';
  requestId: string;
  ok: false;
  error: AnalyticsError;
}

export type AnalyticsResponse =
  | InitializedResponse
  | DatasetLoadedResponse
  | SchemaInspectedResponse
  | AnalysisExecutedResponse
  | AnalyticsErrorResponse;

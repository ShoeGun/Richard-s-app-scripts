export type AnalyticsErrorCode =
  | 'INITIALIZATION_FAILED'
  | 'DATASET_LOAD_FAILED'
  | 'SCHEMA_INSPECTION_FAILED'
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

export type AnalyticsRequest = InitializeRequest | LoadDatasetRequest | InspectSchemaRequest;

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
  | AnalyticsErrorResponse;

export interface InitializeRequest {
  type: 'initialize';
}

export interface InitializeResponse {
  type: 'initialized';
  success: boolean;
  error?: string;
}

export interface LoadDatasetRequest {
  type: 'load-dataset';
  url: string;
}

export interface LoadDatasetResponse {
  type: 'dataset-loaded';
  success: boolean;
  error?: string;
}

export interface InspectSchemaRequest {
  type: 'inspect-schema';
}

export interface InspectSchemaResponse {
  type: 'schema-inspected';
  schema: Record<string, string>;
  error?: string;
}

export type AnalyticsRequest = InitializeRequest | LoadDatasetRequest | InspectSchemaRequest;

export type AnalyticsResponse = InitializeResponse | LoadDatasetResponse | InspectSchemaResponse;
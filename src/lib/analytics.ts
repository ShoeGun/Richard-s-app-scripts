import type {
  AnalyticsRequest,
  AnalyticsResponse,
  SchemaColumn
} from '../workers/analytics.types';

type PendingRequest = {
  resolve: (response: AnalyticsResponse) => void;
  reject: (error: Error) => void;
};

export class AnalyticsClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(
      new URL('../workers/analytics.worker.ts', import.meta.url),
      { type: 'module', name: 'analytics-worker' }
    );
    this.worker.onmessage = (event: MessageEvent<AnalyticsResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Analytics worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  dispose() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Analytics client disposed.'));
    }
    this.pending.clear();
    this.worker.terminate();
  }

  async initialize() {
    const response = await this.request({ type: 'initialize', requestId: crypto.randomUUID() });
    if (response.type !== 'initialized') throw new Error('Unexpected initialization response.');
  }

  async loadDataset(datasetUrl?: string) {
    const response = await this.request({
      type: 'load-dataset',
      requestId: crypto.randomUUID(),
      datasetUrl
    });
    if (response.type !== 'dataset-loaded') throw new Error('Unexpected dataset load response.');
  }

  async inspectSchema(): Promise<SchemaColumn[]> {
    const response = await this.request({
      type: 'inspect-schema',
      requestId: crypto.randomUUID()
    });
    if (response.type !== 'schema-inspected') throw new Error('Unexpected schema response.');
    return response.schema;
  }

  private request(request: AnalyticsRequest) {
    return new Promise<AnalyticsResponse>((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: AnalyticsResponse) {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);

    if (!response.ok) {
      pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
      return;
    }
    pending.resolve(response);
  }
}

export function createAnalyticsClient() {
  return new AnalyticsClient();
}

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { ModelWorkerRequest, ModelWorkerResponse } from './workers/model.types';
import type { AnalyticsRequest, AnalyticsResponse } from './workers/analytics.types';

class MockWorker {
  onmessage: ((event: MessageEvent<AnalyticsResponse | ModelWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  static failSchema = false;
  static invalidPlan = false;

  postMessage(request: AnalyticsRequest | ModelWorkerRequest) {
    if (request.type === 'load-model') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'model-ready',
            model: 'test-browser-model',
            device: 'webgpu',
            cached: true
          }
        } as MessageEvent<ModelWorkerResponse>);
      });
      return;
    }
    if (request.type === 'generate') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'generation-complete',
            text: MockWorker.invalidPlan
              ? '{"sql":"DROP TABLE demo"}'
              : '{"groupBy":["category"],"aggregations":[{"operator":"count","as":"projects"}],"chart":{"type":"bar","x":"category","y":"projects"}}'
          }
        } as MessageEvent<ModelWorkerResponse>);
      });
      return;
    }
    if (request.type === 'execute-plan') {
      queueMicrotask(() => {
        this.onmessage?.(new MessageEvent<AnalyticsResponse | ModelWorkerResponse>('message', {
          data: {
            type: 'analysis-executed',
            requestId: request.requestId,
            ok: true,
            result: {
              rows: [{ category: 'ai', projects: 2 }],
              chart: { type: 'bar', x: 'category', y: 'projects' }
            }
          }
        }));
      });
      return;
    }
    const response = this.responseFor(request);
    queueMicrotask(() => {
      this.onmessage?.({ data: response } as MessageEvent<AnalyticsResponse>);
    });
  }

  terminate() {
    return undefined;
  }

  private responseFor(request: AnalyticsRequest): AnalyticsResponse {
    if (request.type === 'load-dataset') {
      return { type: 'dataset-loaded', requestId: request.requestId, ok: true };
    }
    if (request.type === 'inspect-schema' && MockWorker.failSchema) {
      return {
        type: 'analytics-error',
        requestId: request.requestId,
        ok: false,
        error: { code: 'SCHEMA_INSPECTION_FAILED', message: 'schema unavailable' }
      };
    }
    if (request.type === 'inspect-schema') {
      return {
        type: 'schema-inspected',
        requestId: request.requestId,
        ok: true,
        schema: [
          { name: 'id', type: 'BIGINT', nullable: false },
          { name: 'name', type: 'VARCHAR', nullable: true }
        ]
      };
    }
    return { type: 'initialized', requestId: request.requestId, ok: true };
  }
}

describe('App', () => {
  beforeEach(() => {
    MockWorker.failSchema = false;
    MockWorker.invalidPlan = false;
    vi.stubGlobal('Worker', MockWorker);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `request-${Math.random()}`) });
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: vi.fn(async () => ({})) }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('preserves the portfolio identity and local AI entry point', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /richard jones/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /launch local ai/i })).toBeTruthy();
  });

  it('loads the browser model only after launch and executes a validated local plan', async () => {
    render(<App />);

    expect(screen.queryByLabelText(/ask the browser model/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /launch local ai/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/ask the browser model/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /run on webgpu/i }));
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /local ai analysis result/i })).toBeTruthy();
    });
    expect(screen.getByText('projects')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('surfaces invalid local-model plans without executing them', async () => {
    MockWorker.invalidPlan = true;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /launch local ai/i }));
    await waitFor(() => expect(screen.getByLabelText(/ask the browser model/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /run on webgpu/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/unsupported plan/i);
    });
  });

  it('explains when WebGPU is unavailable without creating the model worker', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /launch local ai/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/webgpu is unavailable/i);
    });
  });

  it('loads and displays the demo dataset schema through the analytics client', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /load demo dataset/i }));

    await waitFor(() => {
      expect(screen.getByRole('table', { name: /demo dataset schema/i })).toBeTruthy();
    });
    expect(screen.getByText('id')).toBeTruthy();
    expect(screen.getByText('BIGINT')).toBeTruthy();
  });

  it('surfaces handled worker errors', async () => {
    MockWorker.failSchema = true;
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /load demo dataset/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('schema unavailable');
    });
  });
});

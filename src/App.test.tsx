import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { AnalyticsRequest, AnalyticsResponse } from './workers/analytics.types';

class MockWorker {
  onmessage: ((event: MessageEvent<AnalyticsResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  static failSchema = false;

  postMessage(request: AnalyticsRequest) {
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
    vi.stubGlobal('Worker', MockWorker);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `request-${Math.random()}`) });
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

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalAiClient, MIN_WEBGPU_MODEL_BUFFER_BYTES, WEBGPU_FAILURE_STORAGE_KEY } from './local-ai';
import type { ModelWorkerRequest } from '../workers/model.types';

class LoadOnlyWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  static requests: ModelWorkerRequest[] = [];

  postMessage(request: ModelWorkerRequest) { LoadOnlyWorker.requests.push(request); }
  terminate() { return undefined; }
}

describe('LocalAiClient WebGPU selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    LoadOnlyWorker.requests = [];
    window.localStorage.removeItem(WEBGPU_FAILURE_STORAGE_KEY);
  });

  it('chooses WASM when the adapter cannot hold the browser model buffer', async () => {
    vi.stubGlobal('Worker', LoadOnlyWorker);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: vi.fn(async () => ({ limits: { maxBufferSize: MIN_WEBGPU_MODEL_BUFFER_BYTES - 1 } })) }
    });

    const client = new LocalAiClient(() => undefined);
    await client.load();

    expect(LoadOnlyWorker.requests[0]).toMatchObject({ type: 'load-model', device: 'wasm' });
    client.dispose();
  });

  it('keeps WebGPU when the adapter advertises enough buffer capacity', async () => {
    vi.stubGlobal('Worker', LoadOnlyWorker);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: vi.fn(async () => ({ limits: { maxBufferSize: MIN_WEBGPU_MODEL_BUFFER_BYTES } })) }
    });

    const client = new LocalAiClient(() => undefined);
    await client.load();

    expect(LoadOnlyWorker.requests[0]).toMatchObject({ type: 'load-model', device: 'webgpu' });
    client.dispose();
  });

  it('sticks to WASM after a prior WebGPU session allocation failure', async () => {
    vi.stubGlobal('Worker', LoadOnlyWorker);
    window.localStorage.setItem(WEBGPU_FAILURE_STORAGE_KEY, '1');
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: vi.fn(async () => ({ limits: { maxBufferSize: MIN_WEBGPU_MODEL_BUFFER_BYTES } })) }
    });

    const client = new LocalAiClient(() => undefined);
    await client.load();

    expect(LoadOnlyWorker.requests[0]).toMatchObject({ type: 'load-model', device: 'wasm' });
    client.dispose();
  });
});

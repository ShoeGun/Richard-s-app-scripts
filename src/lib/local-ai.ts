import type {
  ModelWorkerRequest,
  ModelWorkerResponse
} from '../workers/model.types';

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter(): Promise<unknown>;
  };
};

export class LocalAiClient {
  private worker: Worker | null = null;

  constructor(private readonly onMessage: (message: ModelWorkerResponse) => void) {}

  async load() {
    const gpu = (navigator as NavigatorWithGpu).gpu;
    if (!gpu) {
      throw new Error('WebGPU is unavailable. Use a current Chromium browser with hardware acceleration enabled.');
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU is present, but no hardware adapter is available.');
    }
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/model.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<ModelWorkerResponse>) => this.onMessage(event.data);
      this.worker.onerror = (event) => {
        this.onMessage({ type: 'model-error', message: event.message || 'The model worker failed.' });
      };
    }
    this.post({ type: 'load-model' });
  }

  generate(prompt: string) {
    this.post({ type: 'generate', prompt });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }

  private post(message: ModelWorkerRequest) {
    if (!this.worker) throw new Error('Launch local AI before generating a response.');
    this.worker.postMessage(message);
  }
}

import type {
  ModelWorkerRequest,
  ModelWorkerResponse
} from '../workers/model.types';
import {
  BROWSER_MODEL_ID,
  BROWSER_MODEL_REVISION,
  MOBILE_BROWSER_MODEL_ID,
  MOBILE_BROWSER_MODEL_REVISION,
  type BrowserModelProfile,
  type ModelDevice,
  type ModelMode
} from '../workers/model.types';

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter(): Promise<GpuAdapter | null>;
  };
  locks?: {
    request<T>(
      name: string,
      options: { ifAvailable: boolean },
      callback: (lock: unknown | null) => Promise<T> | T
    ): Promise<T>;
  };
};

type GpuAdapter = {
  limits?: {
    maxBufferSize?: number;
  };
};

// The quantized browser model can require a single roughly 750 MB buffer.
// Avoid selecting WebGPU on adapters whose published limit cannot hold it.
export const MIN_WEBGPU_MODEL_BUFFER_BYTES = 800_000_000;
export const WEBGPU_FAILURE_STORAGE_KEY = 'shoegun-webgpu-session-failed';
const MODEL_LOCK_NAME = 'shoegun-dom-model-session';

function previouslyFailedWebGpu() {
  try {
    return window.localStorage.getItem(WEBGPU_FAILURE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMobileBrowser() {
  const userAgent = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || touchMac;
}

export function browserModelForCurrentDevice(): { id: string; revision: string; profile: BrowserModelProfile } {
  return isMobileBrowser()
    ? { id: MOBILE_BROWSER_MODEL_ID, revision: MOBILE_BROWSER_MODEL_REVISION, profile: 'mobile' }
    : { id: BROWSER_MODEL_ID, revision: BROWSER_MODEL_REVISION, profile: 'desktop' };
}

export class LocalAiClient {
  private worker: Worker | null = null;
  private modelLockRelease: (() => void) | null = null;
  private modelLockRequest: Promise<unknown> | null = null;
  private modelLockInitialized = false;

  constructor(private readonly onMessage: (message: ModelWorkerResponse) => void) {}

  async load() {
    if (!this.modelLockInitialized) {
      this.modelLockInitialized = true;
      const acquired = await this.acquireModelLock();
      if (!acquired) {
        this.modelLockInitialized = false;
        this.onMessage({
          type: 'model-error',
          message: 'Dom is already loaded in another browser tab. Close or reload that tab, then try again here.'
        });
        return;
      }
    }
    const model = browserModelForCurrentDevice();
    const gpu = (navigator as NavigatorWithGpu).gpu;
    // A failed WebGPU session can leave a browser tab with the same adapter but
    // less usable memory. Once that happens, prefer the cached CPU path on later
    // launches instead of making every question pay for the same failed retry.
    let device: ModelDevice = 'wasm';
    if (gpu && !previouslyFailedWebGpu()) {
      try {
        const adapter = await gpu.requestAdapter();
        const maxBufferSize = adapter?.limits?.maxBufferSize;
        if (adapter && (!Number.isFinite(maxBufferSize) || (maxBufferSize as number) >= MIN_WEBGPU_MODEL_BUFFER_BYTES)) {
          device = 'webgpu';
        }
      } catch {
        // Older browsers and drivers can expose navigator.gpu but fail adapter creation.
      }
    }
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/model.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<ModelWorkerResponse>) => this.onMessage(event.data);
      this.worker.onerror = (event) => {
        this.onMessage({ type: 'model-error', message: event.message || 'The model worker failed.' });
      };
    }
    this.post({ type: 'load-model', device, modelId: model.id, revision: model.revision, profile: model.profile });
  }

  generate(prompt: string, mode: ModelMode = 'analysis') {
    this.post({ type: 'generate', prompt, mode });
  }

  dispose() {
    this.modelLockRelease?.();
    this.modelLockRelease = null;
    this.modelLockInitialized = false;
    this.worker?.terminate();
    this.worker = null;
  }

  cancelLoad() {
    this.dispose();
  }

  private post(message: ModelWorkerRequest) {
    if (!this.worker) throw new Error('Launch local AI before generating a response.');
    this.worker.postMessage(message);
  }

  private async acquireModelLock() {
    const locks = (navigator as NavigatorWithGpu).locks;
    if (!locks) return true;

    let resolveAcquired!: (value: boolean) => void;
    const acquired = new Promise<boolean>((resolve) => {
      resolveAcquired = resolve;
    });
    const held = new Promise<void>((resolve) => {
      this.modelLockRelease = resolve;
    });
    this.modelLockRequest = locks.request(MODEL_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolveAcquired(false);
        return;
      }
      resolveAcquired(true);
      await held;
    }).catch(() => {
      resolveAcquired(false);
    });
    return acquired;
  }
}

export const BROWSER_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
export const MOBILE_BROWSER_MODEL_ID = 'onnx-community/SmolLM2-135M-Instruct-ONNX';

export type ModelMode = 'analysis' | 'page';
export type ModelDevice = 'webgpu' | 'wasm';
export type BrowserModelProfile = 'desktop' | 'mobile';

export type ModelWorkerRequest =
  | { type: 'load-model'; device?: ModelDevice; modelId?: string; profile?: BrowserModelProfile }
  | { type: 'generate'; prompt: string; mode?: ModelMode };

export type ModelWorkerResponse =
  | { type: 'model-progress'; status: string; progress: number | null; loaded: number | null; total: number | null }
  | { type: 'model-status'; message: string }
  | { type: 'model-ready'; model: string; profile: BrowserModelProfile; device: ModelDevice; cache: 'browser-cache-enabled' | 'browser-cache-unavailable' }
  | { type: 'generation-started' }
  | { type: 'generation-chunk'; text: string }
  | { type: 'generation-complete'; text: string }
  | { type: 'model-error'; message: string };

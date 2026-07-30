export const BROWSER_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

export type ModelWorkerRequest =
  | { type: 'load-model' }
  | { type: 'generate'; prompt: string };

export type ModelWorkerResponse =
  | { type: 'model-progress'; status: string; progress: number | null; loaded: number | null; total: number | null }
  | { type: 'model-ready'; model: string; device: 'webgpu'; cached: true }
  | { type: 'generation-started' }
  | { type: 'generation-chunk'; text: string }
  | { type: 'generation-complete'; text: string }
  | { type: 'model-error'; message: string };

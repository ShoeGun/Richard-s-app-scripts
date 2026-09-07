import { DESKTOP_PUBLIC_MODEL, MOBILE_PUBLIC_MODEL } from '../lib/public-model-registry';

export const BROWSER_MODEL_ID = DESKTOP_PUBLIC_MODEL.id;
export const BROWSER_MODEL_REVISION = DESKTOP_PUBLIC_MODEL.revision;
export const MOBILE_BROWSER_MODEL_ID = MOBILE_PUBLIC_MODEL.id;
export const MOBILE_BROWSER_MODEL_REVISION = MOBILE_PUBLIC_MODEL.revision;

export type ModelMode = 'analysis' | 'page';
export type ModelDevice = 'webgpu' | 'wasm';
export type BrowserModelProfile = 'desktop' | 'mobile';

export type ModelWorkerRequest =
  | { type: 'load-model'; device?: ModelDevice; modelId?: string; revision?: string; profile?: BrowserModelProfile }
  | { type: 'generate'; prompt: string; mode?: ModelMode };

export type ModelWorkerResponse =
  | { type: 'model-progress'; status: string; progress: number | null; loaded: number | null; total: number | null }
  | { type: 'model-status'; message: string }
  | { type: 'model-ready'; model: string; revision: string; profile: BrowserModelProfile; device: ModelDevice; cache: 'browser-cache-enabled' | 'browser-cache-unavailable' }
  | { type: 'generation-started' }
  | { type: 'generation-chunk'; text: string }
  | { type: 'generation-complete'; text: string }
  | { type: 'model-error'; message: string };

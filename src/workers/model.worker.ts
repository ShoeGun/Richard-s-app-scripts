/// <reference lib="webworker" />

import { env, pipeline, TextStreamer } from '@huggingface/transformers';
import type { ProgressInfo } from '@huggingface/transformers';

import {
  BROWSER_MODEL_ID,
  BROWSER_MODEL_REVISION,
  MOBILE_BROWSER_MODEL_ID,
  MOBILE_BROWSER_MODEL_REVISION,
  type BrowserModelProfile,
  type ModelDevice,
  type ModelMode,
  type ModelWorkerRequest,
  type ModelWorkerResponse
} from './model.types';

const workerScope: typeof self = self;
const createGenerator = (modelId: string, revision: string, device: ModelDevice) => pipeline('text-generation', modelId, {
  device,
  dtype: 'q4',
  revision,
  progress_callback: reportProgress
});

let generatorPromise: ReturnType<typeof createGenerator> | null = null;
let generatorDevice: ModelDevice | null = null;
let generatorModelId = BROWSER_MODEL_ID;
let generatorRevision = BROWSER_MODEL_REVISION;
let generatorProfile: BrowserModelProfile = 'desktop';

env.allowLocalModels = false;
env.useBrowserCache = true;

function send(message: ModelWorkerResponse) {
  workerScope.postMessage(message);
}

const isWebGpuSessionFailure = (detail: string) => /unaligned|unsupported|not supported|failed to allocate|allocate a buffer|can(?:not|'t) create a session|session creation failed|out of memory|out-of-memory|bad_alloc|bad alloc|memory/i.test(detail);
const isMemoryAllocationFailure = (detail: string) => /bad_alloc|bad alloc|cannot create a session|can't create a session|failed to call OrtRun|out of memory|out-of-memory|memory allocation|failed to allocate/i.test(detail);
const errorDetail = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
};

async function disposeGenerator() {
  const pending = generatorPromise;
  generatorPromise = null;
  generatorDevice = null;
  if (!pending) return;
  try {
    const generator = await pending;
    const disposable = generator as unknown as { dispose?: () => Promise<void> | void };
    await disposable.dispose?.();
  } catch {
    // The failed session may already have been torn down by the runtime.
  }
}

function reportProgress(info: ProgressInfo) {
  const measurable = info.status === 'progress' || info.status === 'progress_total';
  send({
    type: 'model-progress',
    status: info.status,
    progress: measurable ? info.progress : null,
    loaded: measurable ? info.loaded : null,
    total: measurable ? info.total : null
  });
}

async function loadGenerator(preferredDevice: ModelDevice = 'wasm', modelId = BROWSER_MODEL_ID, revision = BROWSER_MODEL_REVISION, profile: BrowserModelProfile = 'desktop') {
  generatorPromise ??= createGenerator(modelId, revision, preferredDevice);
  generatorDevice ??= preferredDevice;
  generatorModelId = modelId;
  generatorRevision = revision;
  generatorProfile = profile;
  try {
    const generator = await generatorPromise;
    send({
      type: 'model-ready',
      model: generatorModelId,
      revision: generatorRevision,
      profile: generatorProfile,
      device: generatorDevice || preferredDevice,
      cache: 'browser-cache-enabled'
    });
    return generator;
  } catch (error) {
    generatorPromise = null;
    generatorDevice = null;
    if (env.useBrowserCache && /cache|indexeddb|storage/i.test(errorDetail(error))) {
      env.useBrowserCache = false;
      return loadGenerator(preferredDevice, modelId, revision, profile);
    }
    if (preferredDevice === 'webgpu') {
      send({ type: 'model-status', message: 'WebGPU could not allocate the model session. Switching to CPU WebAssembly; cached model files will be reused.' });
      return loadGenerator('wasm', modelId, revision, profile);
    }
    if (modelId !== MOBILE_BROWSER_MODEL_ID && isMemoryAllocationFailure(errorDetail(error))) {
      send({ type: 'model-status', message: 'The desktop browser model could not allocate a session. Switching to the smaller browser profile so Dom can continue.' });
      await disposeGenerator();
      return loadGenerator('wasm', MOBILE_BROWSER_MODEL_ID, MOBILE_BROWSER_MODEL_REVISION, 'mobile');
    }
    throw error;
  }
}

async function generate(prompt: string, mode: ModelMode = 'analysis', allowWebGpuFallback = true, allowMemoryRecovery = true, maxNewTokensOverride?: number) {
  const generator = generatorPromise
    ? await generatorPromise
    : await loadGenerator('wasm', generatorModelId, generatorRevision, generatorProfile);
  let streamed = '';
  send({ type: 'generation-started' });
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      streamed += text;
      send({ type: 'generation-chunk', text });
    }
  });
  const system = mode === 'page'
    ? [
      'You are Dom, the concise assistant embedded in Richard Jones\'s portfolio. You are speaking to a normal visitor of the site, not to an evaluator or interviewer.',
      'Do not mention testing, evaluation, training, interview preparation, career-path coaching, or an imagined job unless the visitor explicitly asks about those topics.',
      'No runtime page context is supplied unless the user prompt explicitly includes it. Answer the exact request first and do not invent facts, data, capabilities, or completed actions.',
      'Use Richard\'s verified experience across analytics, AI integration, data engineering, full-stack delivery, healthcare, government analytics, banking, legal technology, and consulting. No verified awards list is supplied; do not invent accolades or metrics.',
      'Answer in two to four conversational sentences. If the request needs page evidence that is not supplied, say so plainly.',
      'For an explicit HTML or page-console edit, append exactly one PAGE_ACTION_JSON line with kind (css, javascript, html, or reset), label, and code. Never claim it ran without a browser receipt.',
      'For scheduling, the static site may open consultation options but cannot create a calendar event or access a private calendar.'
    ].join(' ')
    : [
      'You are Dom, Richard\'s browser-based hype man and local assistant in development.',
      'You are the temporary browser model before Dom\'s custom training. Do not claim that you can schedule meetings or access private accounts.',
      'Return only a JSON analysis plan with these optional keys:',
      'filters, groupBy, aggregations, sort, limit, and chart.',
      'Never return SQL, code, markdown, commentary, or unsupported keys.',
      'Use only exact column names supplied with the user request. If a categorical field is unavailable, omit groupBy. For row counts use operator count without a field, and sort by the exact aggregation alias.',
      'Example:',
      '{"groupBy":["category"],"aggregations":[{"operator":"count","as":"projects"}],"sort":[{"field":"projects","direction":"desc"}],"chart":{"type":"bar","x":"category","y":"projects"}}'
    ].join(' ');
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: prompt }
  ];
  let output;
  try {
      output = await generator(messages, {
      max_new_tokens: maxNewTokensOverride ?? (generatorProfile === 'mobile' ? 64 : 96),
      do_sample: false,
      streamer
    });
  } catch (error) {
    const detail = errorDetail(error);
    if (allowWebGpuFallback && generatorDevice === 'webgpu' && isWebGpuSessionFailure(detail)) {
      send({ type: 'model-status', message: 'WebGPU could not allocate the model session. Switching to CPU WebAssembly; cached model files will be reused.' });
      await disposeGenerator();
      await loadGenerator(
        'wasm',
        isMemoryAllocationFailure(detail) ? MOBILE_BROWSER_MODEL_ID : generatorModelId,
        isMemoryAllocationFailure(detail) ? MOBILE_BROWSER_MODEL_REVISION : generatorRevision,
        isMemoryAllocationFailure(detail) ? 'mobile' : generatorProfile
      );
      return generate(prompt, mode, false);
    }
    if (allowMemoryRecovery && isMemoryAllocationFailure(detail)) {
      send({ type: 'model-status', message: 'The browser ran short on inference memory. Clearing the local session and retrying with a shorter answer.' });
      await disposeGenerator();
      await loadGenerator('wasm', MOBILE_BROWSER_MODEL_ID, MOBILE_BROWSER_MODEL_REVISION, 'mobile');
      return generate(prompt, mode, false, false, 96);
    }
    throw error;
  }
  const generated = output[0]?.generated_text;
  const finalMessage = Array.isArray(generated) ? generated[generated.length - 1] : undefined;
  const finalContent = typeof finalMessage?.content === 'string' ? finalMessage.content.trim() : '';
  const finalText = streamed.trim()
    || finalContent
    || 'The browser model returned no text.';
  send({ type: 'generation-complete', text: finalText });
}

let generationQueue = Promise.resolve();

function enqueueGeneration(prompt: string, mode: ModelMode) {
  generationQueue = generationQueue.then(async () => {
    try {
      await generate(prompt, mode);
    } catch (error) {
      send({
        type: 'model-error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

workerScope.onmessage = async (event: MessageEvent<ModelWorkerRequest>) => {
  try {
    if (event.data.type === 'load-model') {
      await loadGenerator(event.data.device, event.data.modelId, event.data.revision, event.data.profile);
      return;
    }
    const prompt = event.data.prompt.trim();
    if (!prompt) throw new Error('Enter a question before running the model.');
    enqueueGeneration(prompt, event.data.mode ?? 'analysis');
  } catch (error) {
    send({
      type: 'model-error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

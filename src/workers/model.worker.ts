/// <reference lib="webworker" />

import { env, pipeline, TextStreamer } from '@huggingface/transformers';
import type { ProgressInfo } from '@huggingface/transformers';

import {
  BROWSER_MODEL_ID,
  type ModelWorkerRequest,
  type ModelWorkerResponse
} from './model.types';

const workerScope: typeof self = self;
const createGenerator = () => pipeline('text-generation', BROWSER_MODEL_ID, {
  device: 'webgpu',
  dtype: 'q4',
  progress_callback: reportProgress
});

let generatorPromise: ReturnType<typeof createGenerator> | null = null;

env.allowLocalModels = false;
env.useBrowserCache = true;

function send(message: ModelWorkerResponse) {
  workerScope.postMessage(message);
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

async function loadGenerator() {
  generatorPromise ??= createGenerator();
  try {
    const generator = await generatorPromise;
    send({
      type: 'model-ready',
      model: BROWSER_MODEL_ID,
      device: 'webgpu',
      cached: true
    });
    return generator;
  } catch (error) {
    generatorPromise = null;
    throw error;
  }
}

async function generate(prompt: string) {
  const generator = await loadGenerator();
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
  const messages = [
    {
      role: 'system' as const,
      content: 'You are a concise portfolio data-analysis assistant. Suggest safe analytical steps and never invent results.'
    },
    { role: 'user' as const, content: prompt }
  ];
  const output = await generator(messages, {
    max_new_tokens: 128,
    do_sample: false,
    streamer
  });
  const generated = output[0]?.generated_text;
  const finalMessage = Array.isArray(generated) ? generated[generated.length - 1] : undefined;
  const finalContent = typeof finalMessage?.content === 'string' ? finalMessage.content.trim() : '';
  const finalText = streamed.trim()
    || finalContent
    || 'The browser model returned no text.';
  send({ type: 'generation-complete', text: finalText });
}

workerScope.onmessage = async (event: MessageEvent<ModelWorkerRequest>) => {
  try {
    if (event.data.type === 'load-model') {
      await loadGenerator();
      return;
    }
    const prompt = event.data.prompt.trim();
    if (!prompt) throw new Error('Enter a question before running the model.');
    await generate(prompt);
  } catch (error) {
    send({
      type: 'model-error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

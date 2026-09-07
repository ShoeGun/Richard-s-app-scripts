export type DomTrainingTarget = 'desktop-gpu' | 'desktop-cpu' | 'mobile';

export type DomTrainingExample = {
  id: string;
  target: DomTrainingTarget;
  source: 'browser-test';
  approvedAt: string;
  messages: [
    { role: 'system'; content: string },
    { role: 'user'; content: string },
    { role: 'assistant'; content: string }
  ];
};

const STORAGE_KEY = 'shoegun-dom-training-captures';
const MAX_CAPTURED_EXAMPLES = 40;
const TRAINING_SYSTEM = [
  'You are Dom, a concise browser-based assistant.',
  'No runtime page context is supplied unless it is explicitly attached.',
  'Answer only from the question and learned behavior; do not invent facts, actions, or connected data.'
].join(' ');

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function createTrainingExample({
  request,
  response,
  target,
  approvedAt = new Date().toISOString()
}: {
  request: string;
  response: string;
  target: DomTrainingTarget;
  approvedAt?: string;
}): DomTrainingExample {
  const user = clean(request);
  const assistant = response.trim();
  if (!user) throw new Error('A training example needs a user question.');
  if (!assistant) throw new Error('A training example needs an approved answer.');
  return {
    id: `dom-${target}-${Date.now()}`,
    target,
    source: 'browser-test',
    approvedAt,
    messages: [
      { role: 'system', content: TRAINING_SYSTEM },
      { role: 'user', content: user },
      { role: 'assistant', content: assistant }
    ]
  };
}

export function readTrainingExamples(storage: Storage | null = defaultStorage()) {
  if (!storage) return [] as DomTrainingExample[];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed as DomTrainingExample[] : [];
  } catch {
    return [] as DomTrainingExample[];
  }
}

export function saveTrainingExample(example: DomTrainingExample, storage: Storage | null = defaultStorage()) {
  if (!storage) return [example];
  const examples = [...readTrainingExamples(storage), example].slice(-MAX_CAPTURED_EXAMPLES);
  storage.setItem(STORAGE_KEY, JSON.stringify(examples));
  return examples;
}

export function trainingExamplesJsonl(examples: DomTrainingExample[]) {
  return examples.map((example) => JSON.stringify(example)).join('\n') + (examples.length ? '\n' : '');
}

export function trainingCaptureCount(storage: Storage | null = defaultStorage()) {
  return readTrainingExamples(storage).length;
}

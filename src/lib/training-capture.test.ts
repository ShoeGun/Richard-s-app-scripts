import { describe, expect, it } from 'vitest';

import { createTrainingExample, trainingExamplesJsonl } from './training-capture';

describe('Dom training capture', () => {
  it('creates a context-free reviewed example for a selected target', () => {
    const example = createTrainingExample({
      request: '  What can you do?  ',
      response: 'I can answer questions about the portfolio and ask for context when I need it.',
      target: 'desktop-gpu',
      approvedAt: '2026-08-02T00:00:00.000Z'
    });

    expect(example.target).toBe('desktop-gpu');
    expect(example.messages[0].content).not.toContain('Richard');
    expect(example.messages[0].content).toContain('No runtime page context');
    expect(trainingExamplesJsonl([example])).toContain('"role":"assistant"');
  });

  it('rejects an unreviewed empty answer', () => {
    expect(() => createTrainingExample({
      request: 'What can you do?',
      response: ' ',
      target: 'mobile'
    })).toThrow(/approved answer/i);
  });
});

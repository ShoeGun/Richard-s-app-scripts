import { describe, expect, it } from 'vitest';

import {
  DESKTOP_PUBLIC_MODEL,
  MOBILE_PUBLIC_MODEL,
  PUBLIC_HANDOFF_LAB,
  publicModelForProfile,
  shortModelRevision
} from './public-model-registry';

describe('public Hugging Face model registry', () => {
  it('keeps runnable models separate from model-companion artifacts', () => {
    expect(DESKTOP_PUBLIC_MODEL.role).toBe('runnable-browser-model');
    expect(MOBILE_PUBLIC_MODEL.role).toBe('runnable-browser-model');
    expect(PUBLIC_HANDOFF_LAB.role).toBe('model-companion-artifacts');
    expect(PUBLIC_HANDOFF_LAB.id).not.toBe(DESKTOP_PUBLIC_MODEL.id);
  });

  it('pins every public target to an immutable Hugging Face revision', () => {
    for (const target of [DESKTOP_PUBLIC_MODEL, MOBILE_PUBLIC_MODEL, PUBLIC_HANDOFF_LAB]) {
      expect(target.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(target.hubUrl).toBe(`https://huggingface.co/${target.id}`);
      expect(target.requiredFiles.length).toBeGreaterThan(0);
    }
  });

  it('selects the declared profile and exposes a compact revision label', () => {
    expect(publicModelForProfile('mobile').id).toBe(MOBILE_PUBLIC_MODEL.id);
    expect(publicModelForProfile('desktop').id).toBe(DESKTOP_PUBLIC_MODEL.id);
    expect(shortModelRevision(DESKTOP_PUBLIC_MODEL.revision)).toHaveLength(8);
  });
});

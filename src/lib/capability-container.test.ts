import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_HOTSHOT_CONTAINER,
  capabilityContainerPrompt,
  capabilityContainerReceipt,
  validateCapabilityContainer
} from './capability-container';

describe('DOMCAP1 capability containers', () => {
  it('activates only trusted host tools and stays compact', () => {
    const tools = validateCapabilityContainer(ANALYTICS_HOTSHOT_CONTAINER);
    const receipt = capabilityContainerReceipt(ANALYTICS_HOTSHOT_CONTAINER);

    expect(tools.map((tool) => tool.id)).toEqual([
      'data.load_demo',
      'data.public_google_sheet',
      'analytics.safe_plan'
    ]);
    expect(receipt.estimatedActivationTokens).toBeLessThan(500);
    expect(receipt.probeCount).toBe(3);
  });

  it('emits an inspectable prompt without executable implementation source', () => {
    const prompt = capabilityContainerPrompt(ANALYTICS_HOTSHOT_CONTAINER);

    expect(prompt).toContain('[DOMCAP1 dom.analytics-hotshot@0.1.0]');
    expect(prompt).toContain('analytics.safe_plan');
    expect(prompt).not.toContain('window.__shoegun');
  });

  it('fails closed when a container asks for an untrusted tool', () => {
    expect(() => validateCapabilityContainer({
      ...ANALYTICS_HOTSHOT_CONTAINER,
      toolIds: ['network.fetch_anything']
    })).toThrow('unknown or disabled host tool');
  });
});

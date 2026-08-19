import { describe, expect, it } from 'vitest';

import { getDomTool, toolCatalogPrompt, toolCatalogRow } from './dom-tool-catalog';

describe('Dom tool catalog', () => {
  it('exposes a compact row for a safe local page tool', () => {
    const tool = getDomTool('dom.fireworks');
    expect(tool).not.toBeNull();
    expect(toolCatalogPrompt('dom.fireworks')).toContain('dom.fireworks | none | dom.fireworks');
    expect(getDomTool('dom.hotdog_rain')).not.toBeNull();
  });

  it('does not expose disabled or unknown tools to the model', () => {
    expect(getDomTool('notify.send_text')).toBeNull();
    expect(toolCatalogPrompt('unknown.tool')).toBe('');
  });

  it('keeps implementation IDs distinct from executable source', () => {
    const tool = getDomTool('dom.face.animate');
    expect(tool).not.toBeNull();
    expect(toolCatalogRow(tool!)).not.toContain('window.__shoegun');
  });
});

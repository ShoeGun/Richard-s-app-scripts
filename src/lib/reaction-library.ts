export type BrowserReaction = {
  id: string;
  label: string;
  mood: string;
  searchUrl: string;
};

// Static Pages cannot safely hide a Giphy or Tenor API key. These keyless search
// links give Dom a small, predictable reaction vocabulary without adding a secret.
export const REACTION_LIBRARY: BrowserReaction[] = [
  { id: 'tiny-win', label: 'Tiny win', mood: 'encouraging', searchUrl: 'https://giphy.com/search/tiny-win' },
  { id: 'chef-kiss', label: 'Chef kiss', mood: 'excellent', searchUrl: 'https://giphy.com/search/chef-kiss' },
  { id: 'mind-blown', label: 'Mind blown', mood: 'surprising', searchUrl: 'https://giphy.com/search/mind-blown' },
  { id: 'thinking', label: 'Thinking', mood: 'curious', searchUrl: 'https://giphy.com/search/thinking' },
  { id: 'victory-lap', label: 'Victory lap', mood: 'celebratory', searchUrl: 'https://giphy.com/search/victory-lap' },
  { id: 'gentle-oops', label: 'Gentle oops', mood: 'recovering', searchUrl: 'https://giphy.com/search/gentle-oops' }
];

export function exposeReactionLibrary(target: Window = window.parent) {
  (target as Window & { __DOM_REACTION_LIBRARY__?: BrowserReaction[] }).__DOM_REACTION_LIBRARY__ = REACTION_LIBRARY;
}

export function reactionLibraryPrompt() {
  return REACTION_LIBRARY.map(({ id, label, mood, searchUrl }) => `${id}: ${label} (${mood}) - ${searchUrl}`).join('\n');
}

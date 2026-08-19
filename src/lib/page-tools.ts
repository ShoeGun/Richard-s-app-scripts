export type PageActionKind = 'css' | 'javascript' | 'html' | 'inspect' | 'remove' | 'reset';

export interface PageAction {
  kind: PageActionKind;
  label: string;
  code?: string;
  selector?: string;
  text?: string;
}

export interface PageActionReceipt {
  label: string;
  kind: PageActionKind;
  detail: string;
}

const LIVE_STYLE_ID = 'shoegun-live-edit-style';
const LIVE_BACKGROUND_STYLE_ID = LIVE_STYLE_ID;
const LIVE_TEXT_STYLE_ID = 'shoegun-live-text-style';
const JIGGLE_STYLE_ID = 'shoegun-jiggle-style';
const TEXT_JIGGLE_STYLE_ID = 'shoegun-text-jiggle-style';
const LIVE_HTML_ID = 'shoegun-live-html';
const MAX_ACTION_CODE = 12000;

function isActionKind(value: unknown): value is PageActionKind {
  return value === 'css' || value === 'javascript' || value === 'html' || value === 'inspect' || value === 'remove' || value === 'reset';
}

function normalizeAction(value: unknown): PageAction | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!isActionKind(candidate.kind) || typeof candidate.label !== 'string') return null;
  const code = typeof candidate.code === 'string' ? candidate.code.slice(0, MAX_ACTION_CODE) : undefined;
  const selector = typeof candidate.selector === 'string' ? candidate.selector.trim().slice(0, 160) : undefined;
  const text = typeof candidate.text === 'string' ? candidate.text.trim().slice(0, 120) : undefined;
  if (candidate.kind !== 'reset' && candidate.kind !== 'inspect' && candidate.kind !== 'remove' && !code?.trim()) return null;
  if ((candidate.kind === 'inspect' || candidate.kind === 'remove') && !selector && !text) return null;
  return { kind: candidate.kind, label: candidate.label.slice(0, 160), code, selector, text };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

function readJsonObject(text: string, start: number) {
  const open = text.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return text.slice(open, index + 1);
  }
  return null;
}

export function parsePageAction(text: string): PageAction | null {
  const marker = text.indexOf('PAGE_ACTION_JSON');
  if (marker >= 0) {
    const json = readJsonObject(text, marker);
    if (json) {
      try {
        const action = normalizeAction(JSON.parse(json));
        if (action) return action;
      } catch {
        // Continue to the human-friendly code-block parser.
      }
    }
  }

  const codeBlock = text.match(/```\s*(css|javascript|js|html)\s*\n([\s\S]*?)```/i);
  if (!codeBlock) return null;
  const kind = codeBlock[1].toLowerCase() === 'css'
    ? 'css'
    : codeBlock[1].toLowerCase() === 'html' ? 'html' : 'javascript';
  return normalizeAction({ kind, label: `Apply ${kind} edit from the model`, code: codeBlock[2] });
}

export function inferExplicitPageAction(prompt: string): PageAction | null {
  if ((/\b(reset|undo)\b/i.test(prompt) && !/\b(project|card)s?\b/i.test(prompt)) || /\brestore\b.*\b(page|edit|change|style|black|dark|white|jiggle|it|thing)\b/i.test(prompt)) {
    return { kind: 'reset', label: 'Reset live page edits' };
  }
  if (/\b(connect|use|paste|share|load)\b.*\b(spreadsheet|google\s+sheet|sheet)\b/i.test(prompt)) {
    const sheetUrl = prompt.match(/https:\/\/docs\.google\.com\/spreadsheets\/[^\s<]+/i)?.[0]?.replace(/[),.;]+$/, '');
    const urlPayload = sheetUrl ? `, url: ${JSON.stringify(sheetUrl)}` : '';
    return {
      kind: 'javascript',
      label: 'Focus the public Google Sheet field',
      code: `const frame = document.querySelector('#browser-agent iframe'); window.dispatchEvent(new CustomEvent('shoegun-agent-guidance', { detail: { message: 'Enter the public sheet URL here, then connect it.' } })); frame?.contentWindow?.postMessage({ type: 'shoegun-focus-sheet'${urlPayload} }, '*');`
    };
  }
  const descriptionMatch = prompt.match(/\b(?:described as|described by|containing|with (?:the )?text|that says|labeled)\s+["']?([^"'\n?.]{2,100})["']?/i);
  if (descriptionMatch && /\b(inspect|find|list|show|locate)\b.*\b(divs?|elements?|selectors?)\b/i.test(prompt)) {
    const text = descriptionMatch[1].trim().replace(/^the text\s+/i, '');
    return { kind: 'inspect', label: 'Inspect divs described by ' + text, selector: 'div', text };
  }
  const insertMessageMatch = prompt.match(/\b(?:insert|add|create)\b[\s\S]*?\bdiv\b[\s\S]*?\b(?:says?|with the text|containing)\s+["']?([^"'\n?.]{2,180})["']?/i);
  if (insertMessageMatch) {
    const message = insertMessageMatch[1].trim();
    return {
      kind: 'html',
      label: 'Insert a live portfolio message',
      code: `<div id="portfolio-live-message" class="portfolio-live-message">${escapeHtml(message)}</div>`
    };
  }
  if (/\b(?:use|open|run)\b[\s\S]*\bpage\s+console\b[\s\S]*\b(?:add|apply)\b[\s\S]*\bclass\b[\s\S]*\bconsultation\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Add a class to the consultation panel',
      code: "document.querySelector('#consultation-booking')?.classList.add('is-highlighted');"
    };
  }
  if (/\b(inspect|find|list|show)\b.*\b(divs?|elements?|selectors?)\b/i.test(prompt)) {
    const selector = prompt.match(/(?:matching|with|under|inside)\s+([#.][\w-]+(?:\s+[\w-]+)?)/i)?.[1] || 'div';
    return { kind: 'inspect', label: `Inspect ${selector} elements`, selector };
  }
  if (/\b(remove|delete)\b.*\b(div|element|message|panel)\b/i.test(prompt)) {
    const selector = prompt.match(/(?:id|selector)\s+([#.][\w-]+)/i)?.[1]
      || prompt.match(/\bwith\s+id\s+([\w-]+)/i)?.[1].replace(/^/, '#')
      || prompt.match(/\b(#[\w-]+|\.[\w-]+)\b/)?.[1];
    if (selector) return { kind: 'remove', label: `Remove ${selector}`, selector };
  }
  if (/\b(firework|fireworks|celebrat|burst)\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Celebrate with Dom\'s page fireworks',
      code: "window.__shoegunDomEffects?.fireworks(); window.__shoegunDomFace?.setMood('celebrate');"
    };
  }
  if (/\b(?:stop|clear|end|cancel)\b[\s\S]*\bhot\s*dogs?\b|\bhot\s*dogs?\b[\s\S]*\b(?:stop|clear|end|cancel)\b/i.test(prompt)) {
    return { kind: 'javascript', label: 'Stop the hotdog rain', code: "window.__shoegunDomEffects?.stopHotdogRain();" };
  }
  if (/\bhot\s*dogs?\b/i.test(prompt) && /\b(rain|shower|fall|drop)\b/i.test(prompt)) {
    return { kind: 'javascript', label: 'Make hotdogs rain over the portfolio', code: "window.__shoegunDomEffects?.hotdogRain();" };
  }
  const moodMatch = prompt.match(/\b(sleepy|sleepier|sleepiest|happy|happier|happiest|curious|alert|wonder|awe|thinking|surprised|concerned|worried|celebrate|celibrate)\b/i);
  if (moodMatch && (/\b(?:mood|face|expression|yourself|dom)\b/i.test(prompt) || /^[\s]*(?:sleepier|sleepiest|happier|happiest|celebrate|celibrate)[!.?\s]*$/i.test(prompt))) {
    const word = moodMatch[1].toLowerCase();
    const mood = /sleep/i.test(word) ? 'sleepy'
      : /happy/i.test(word) ? 'happy'
        : /concern|worr/i.test(word) ? 'concerned'
          : word === 'celibrate' || word === 'celebrate' ? 'celebrate' : word;
    return { kind: 'javascript', label: `Set Dom's chart face to ${mood}`, code: `window.__shoegunDomFace?.setMood('${mood}');` };
  }
  if (/\b(animate|move|wake|express|expression)\b.*\b(face|eyes|mouth|chart|dom)/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Animate Dom\'s chart face',
      code: "window.__shoegunDomFace?.animate();"
    };
  }
  if (/\b(happy|smile|curious|alert|wonder|awe|thinking|surprised|concerned|sleepy|celebrate)\b/i.test(prompt) && /\b(face|dom|chart|look|expression)/i.test(prompt)) {
    const mood = /happy|smile/i.test(prompt) ? 'happy'
      : /alert/i.test(prompt) ? 'alert'
        : /wonder|awe/i.test(prompt) ? 'wonder'
          : /thinking/i.test(prompt) ? 'thinking'
            : /surprised/i.test(prompt) ? 'surprised'
              : /concerned/i.test(prompt) ? 'concerned'
                : /sleepy/i.test(prompt) ? 'sleepy'
                  : /celebrate/i.test(prompt) ? 'celebrate' : 'curious';
    return {
      kind: 'javascript',
      label: `Set Dom's chart face to ${mood}`,
      code: `window.__shoegunDomFace?.setMood('${mood}');`
    };
  }
  if (/\b(roll\s*up|collapse|close|hide)\b.*\b(work\s*history|timeline)\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Roll up the work-history timeline',
      code: "document.querySelector('.original-timeline-panel')?.toggleAttribute('open', false);"
    };
  }
  if (/\b(stack|roll\s*up|collapse)\b.*\b(project|card)s?\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Stack the featured project cards',
      code: "window.__shoegunPresentation?.stack();"
    };
  }
  if ((/\b(split|side[- ]by[- ]side|workspace|presentation)\b/i.test(prompt) && /\b(kepler|sheet|spreadsheet|map)\b/i.test(prompt)) || /\bkepler\b[\s\S]*\bsheet\b|\bsheet\b[\s\S]*\bkepler\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Open the Kepler and Sheet presentation workspace',
      code: "window.__shoegunPresentation?.openWorkspace('kepler');"
    };
  }
  const projectMatch = prompt.match(/\b(?:show|present|open|explain|focus on)\b.*?\b(henry(?:['’]s)?|kepler|altitude)\b/i);
  if (projectMatch) {
    const key = projectMatch[1].toLowerCase().startsWith('henry') ? 'henrys' : projectMatch[1].toLowerCase();
    return {
      kind: 'javascript',
      label: `Present the ${key} project`,
      code: `window.__shoegunPresentation?.showProject('${key}');`
    };
  }
  if (/\b(show|restore|unstack|reset)\b.*\b(project|card)s?\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Restore the featured project cards',
      code: "window.__shoegunPresentation?.reset();"
    };
  }
  if (/\b(open|expand|show|unroll)\b.*\b(work\s*history|timeline)\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Expand the work-history timeline',
      code: "document.querySelector('.original-timeline-panel')?.toggleAttribute('open', true);"
    };
  }
  if (/\b(book|schedule|arrange|set\s*up|request)\b.*\b(consult|consultation|interview|meeting)\b|\b20\s*[- ]?minute\b.*\b(consult|consultation|intro)\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Open consultation and interview options',
      code: "document.querySelector('#consultation-booking')?.toggleAttribute('open', true);"
    };
  }
  const textColorMatch = prompt.match(/\b(?:make|turn|set)\b[\s\S]*\btext\b[\s\S]*?\b(gray|grey|red|blue|green|yellow|purple|orange|pink|black|white)\b/i);
  if (textColorMatch) {
    const color = textColorMatch[1].toLowerCase() === 'grey' ? 'gray' : textColorMatch[1].toLowerCase();
    return {
      kind: 'css',
      label: 'Set page text color to ' + color,
      code: 'body :where(h1, h2, h3, h4, h5, h6, p, span, a, li, label, button, strong, em, small, div) { color: ' + color + ' !important; }'
    };
  }
  if (/\bfirst\s+div\b/i.test(prompt) && /\ball\s+others?\b/i.test(prompt)) {
    return {
      kind: 'css',
      label: 'Color the first div differently from the others',
      code: 'body > div { background-color: #fff !important; color: #000 !important; } body > div:first-child { background-color: #000 !important; color: #fff !important; }'
    };
  }
  if (/\b(everything|the whole page|all|the page|this page)\b.*\bwhite\b|\b(make|turn|set)\b.*\b(website|page|background|everything|all|it)\b.*\bwhite\b|\b(make|turn|set)\b.*\bwhite\b/i.test(prompt)) {
    return {
      kind: 'css',
      label: 'Turn the portfolio white',
      code: 'html, body, body * { background-color: #fff !important; color: #000 !important; border-color: #000 !important; } body img { filter: none; }'
    };
  }
  if (/\b(?:stop|disable|remove|end|cancel)\b[\s\S]*\b(?:jiggle|jiggling|wiggle|wobble|shake)\b/i.test(prompt)) {
    return {
      kind: 'javascript',
      label: 'Stop the portfolio jiggle',
      code: "document.getElementById('shoegun-jiggle-style')?.remove(); document.getElementById('shoegun-text-jiggle-style')?.remove(); document.querySelectorAll('.shoegun-jiggle-target').forEach((element) => element.classList.remove('shoegun-jiggle-target'));"
    };
  }
  if (/\b(jiggle|wobble|wiggle|shake)\b/i.test(prompt)) {
    if (/\btext\b/i.test(prompt) && !/\b(?:everything|all|whole page|the page)\b/i.test(prompt)) {
      return {
        kind: 'css',
        label: 'Make page text jiggle',
      code: '@keyframes shoegun-text-jiggle { from { transform: translate3d(-2px, 0, 0) rotate(-.25deg); } to { transform: translate3d(2px, 0, 0) rotate(.25deg); } } body :where(h1, h2, h3, h4, h5, h6, p, span, a, li, label, button, strong, em, small) { animation: shoegun-text-jiggle .35s ease-in-out infinite alternate !important; }'
      };
    }
    const targetMatch = prompt.match(/\b(?:described as|described by|containing|with (?:the )?text|that says|labeled|with)\s+["']?([^"'\n?.]{2,100}?)["']?(?:\s+(?:in it|inside|on the page))?\s+(?=jiggle|jiggling|wiggle|wobble|shake)\b/i);
    if (targetMatch && !/\b(everything|all|whole page|the page)\b/i.test(prompt)) {
      const targetText = JSON.stringify(targetMatch[1].trim().replace(/^the text\s+/i, '').toLowerCase());
      return {
        kind: 'javascript',
        label: 'Make divs described by ' + targetMatch[1].trim() + ' jiggle',
        code: "const needle = " + targetText + "; const style = document.getElementById('shoegun-jiggle-style') || Object.assign(document.head.appendChild(document.createElement('style')), { id: 'shoegun-jiggle-style' }); style.textContent = '@keyframes shoegun-jiggle-target { from { transform: translate3d(-2px, 0, 0) rotate(-.35deg); } to { transform: translate3d(2px, 0, 0) rotate(.35deg); } } .shoegun-jiggle-target { animation: shoegun-jiggle-target .35s ease-in-out infinite alternate !important; }'; const matches = Array.from(document.querySelectorAll('div')).filter((element) => (element.textContent || '').toLowerCase().includes(needle)); const specific = matches.filter((element) => !matches.some((candidate) => candidate !== element && element.contains(candidate))); document.querySelectorAll('.shoegun-jiggle-target').forEach((element) => element.classList.remove('shoegun-jiggle-target')); specific.forEach((element) => element.classList.add('shoegun-jiggle-target'));"
      };
    }
    return {
      kind: 'css',
      label: 'Make the portfolio jiggle',
      code: '@keyframes shoegun-jiggle { from { transform: translate3d(-2px, 0, 0) rotate(-.35deg); } to { transform: translate3d(2px, 0, 0) rotate(.35deg); } } html, body, body *:not(script):not(style) { animation: shoegun-jiggle .35s ease-in-out infinite alternate !important; }'
    };
  }
  if (/\b(everything|the whole page|all)\b.*\bblack\b|\b(make|turn)\b.*\bblack\b/i.test(prompt)) {
    return {
      kind: 'css',
      label: 'Turn the portfolio black',
      code: 'html, body, body * { background-color: #000 !important; color: #fff !important; border-color: #fff !important; }'
    };
  }
  const colorMatch = prompt.match(/\b(?:make|turn|set)\b[\s\S]*?\b(gray|grey|red|blue|green|yellow|purple|orange|pink)\b/i);
  if (colorMatch && /\b(everything|all|whole page|the page|background|website|site)\b/i.test(prompt)) {
    const color = colorMatch[1].toLowerCase() === 'grey' ? 'gray' : colorMatch[1].toLowerCase();
    const foreground = ['yellow', 'pink'].includes(color) ? '#000' : '#fff';
    return {
      kind: 'css',
      label: 'Set the portfolio background to ' + color,
      code: 'html, body, body * { background-color: ' + color + ' !important; color: ' + foreground + ' !important; border-color: ' + foreground + ' !important; }'
    };
  }
  if (/\b(dark mode|darken everything|make everything dark)\b/i.test(prompt)) {
    return {
      kind: 'css',
      label: 'Apply a dark page experiment',
      code: 'html, body { background: #050505 !important; color: #f5f5f5 !important; } body * { color: #f5f5f5 !important; border-color: #555 !important; }'
    };
  }
  const codeBlock = prompt.match(/```\s*(css|javascript|js|html)\s*\n([\s\S]*?)```/i);
  if (!codeBlock) return null;
  const kind = codeBlock[1].toLowerCase() === 'css'
    ? 'css'
    : codeBlock[1].toLowerCase() === 'html' ? 'html' : 'javascript';
  return normalizeAction({ kind, label: `Run requested ${kind} edit`, code: codeBlock[2] });
}

function removeLiveHtml(document: Document) {
  document.getElementById(LIVE_HTML_ID)?.remove();
}

export function applyPageAction(action: PageAction, target: Window = window.parent): PageActionReceipt {
  const document = target.document;
  if (action.kind === 'reset') {
    document.getElementById(LIVE_STYLE_ID)?.remove();
    document.getElementById(LIVE_TEXT_STYLE_ID)?.remove();
    document.getElementById(JIGGLE_STYLE_ID)?.remove();
    document.getElementById(TEXT_JIGGLE_STYLE_ID)?.remove();
    removeLiveHtml(document);
    document.body.classList.remove('shoegun-play-mode');
    document.getElementById('shoegun-play-mode-style')?.remove();
    document.querySelectorAll('.shoegun-jiggle-target').forEach((element) => element.classList.remove('shoegun-jiggle-target'));
    return { kind: action.kind, label: action.label, detail: 'Removed live CSS, HTML, and play-mode edits.' };
  }
  const code = action.code || '';
  if (action.kind !== 'inspect' && action.kind !== 'remove' && !code.trim()) throw new Error('The page action did not include any code.');
  if (action.kind === 'css') {
    const styleId = /shoegun-text-jiggle/.test(code)
      ? TEXT_JIGGLE_STYLE_ID
      : /shoegun-jiggle/.test(code)
        ? JIGGLE_STYLE_ID
        : /background(?:-color)?\s*:/.test(code)
          ? LIVE_BACKGROUND_STYLE_ID
          : /\bcolor\s*:/.test(code)
            ? LIVE_TEXT_STYLE_ID
            : LIVE_STYLE_ID;
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = code;
    return { kind: action.kind, label: action.label, detail: `Applied ${code.length} CSS characters to the live portfolio.` };
  }
  if (action.kind === 'html') {
    removeLiveHtml(document);
    const container = document.createElement('div');
    container.id = LIVE_HTML_ID;
    container.innerHTML = code;
    document.body.appendChild(container);
    return { kind: action.kind, label: action.label, detail: 'Injected HTML into the live portfolio body.' };
  }
  if (action.kind === 'inspect') {
    const selector = action.selector || 'div';
    if (/^(html|head|body|script|style)$/i.test(selector)) throw new Error('That selector is not allowed for bounded inspection.');
    let elements: Element[];
    try {
      elements = Array.from(document.querySelectorAll(selector))
        .filter((element) => !action.text || (element.textContent || '').toLowerCase().includes(action.text.toLowerCase()))
        .slice(0, 80);
    }
    catch { throw new Error(`Invalid inspection selector: ${selector}`); }
    const summary = elements.map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 6) : [],
      role: element.getAttribute('role'),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    }));
    return { kind: action.kind, label: action.label, detail: `Observed ${elements.length} element(s) for ${selector}: ${JSON.stringify(summary)}` };
  }
  if (action.kind === 'remove') {
    const selector = action.selector || '';
    if (!selector || /^(html|head|body|script|style)$/i.test(selector)) throw new Error('That selector is not allowed for bounded removal.');
    let elements: Element[];
    try { elements = Array.from(document.querySelectorAll(selector)).slice(0, 20); }
    catch { throw new Error(`Invalid removal selector: ${selector}`); }
    elements.forEach((element) => element.remove());
    return { kind: action.kind, label: action.label, detail: `Removed ${elements.length} matching live page element(s) for ${selector}. Reload the page to restore source content.` };
  }
  const evaluator = (target as Window & { Function: FunctionConstructor }).Function;
  const pageConsole = (target as Window & { console: unknown }).console;
  evaluator('window', 'document', 'console', `"use strict";\n${code}`)(target, document, pageConsole);
  return { kind: action.kind, label: action.label, detail: 'Executed JavaScript in the live portfolio page context.' };
}

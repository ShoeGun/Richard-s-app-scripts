export interface PageContext {
  title: string;
  path: string;
  visibleText: string;
  html: string;
  architecture: string[];
  javascript: string;
  styles: string;
  console: string[];
  diagnostics: string[];
  trace: string[];
  charting: string[];
  environment: string[];
}

export interface PageContextPromptOptions {
  includeSnapshot?: boolean;
  includeSource?: boolean;
  includeDiagnostics?: boolean;
  includeTrace?: boolean;
  includeConsole?: boolean;
  includeEnvironment?: boolean;
}

type ConsoleCapture = {
  installed?: boolean;
  entries: string[];
  handlersInstalled?: boolean;
};

const MAX_TEXT = 3500;
const MAX_SOURCE = 9000;

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

function redactFormValues(html: string) {
  return html
    .replace(/\s(value|data-[\w-]+)="[^"]*"/gi, ' $1="[redacted]"')
    .replace(/\s(value|data-[\w-]+)='[^']*'/gi, " $1='[redacted]'");
}

function installConsoleCapture(target: Window) {
  const key = '__shoegunPageConsole' as const;
  const capture = (target as Window & { [key]?: ConsoleCapture })[key] ?? { installed: true, entries: [] };
  (target as Window & { [key]?: ConsoleCapture })[key] = capture;

  if (!capture.installed) {
    capture.installed = true;
    const consoleObject = (target as Window & typeof globalThis).console;
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      const original = consoleObject[method].bind(consoleObject);
      consoleObject[method] = (...args: unknown[]) => {
        const message = args.map((arg) => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        capture.entries.push(clip(`${method}: ${message}`, 1000));
        if (capture.entries.length > 50) capture.entries.shift();
        original(...args);
      };
    }
  }

  if (!capture.handlersInstalled) {
    const record = (message: string) => {
      capture.entries.push(clip(message, 1000));
      if (capture.entries.length > 50) capture.entries.shift();
    };
    const handleError = (event: Event) => {
      if (event instanceof ErrorEvent) {
        record(`runtime error: ${event.message || 'Unknown error'}${event.filename ? ` at ${event.filename}:${event.lineno}` : ''}`);
      } else {
        const element = event.target as HTMLElement | null;
        record(`resource error: ${element?.tagName?.toLowerCase() || 'unknown element'}`);
      }
    };
    target.addEventListener('error', handleError, true);
    target.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      record(`unhandled rejection: ${reason}`);
    });
    capture.handlersInstalled = true;
  }

  return capture;
}

function readStyles(document: Document, includeSource: boolean) {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules);
      chunks.push(includeSource
        ? rules.map((rule) => rule.cssText).join('\n')
        : `${sheet.href || 'inline stylesheet'} (${rules.length} rules)`);
    } catch {
      const href = sheet.href || 'external stylesheet';
      chunks.push(`[not readable from this page: ${href}]`);
    }
  }
  return clip(chunks.join('\n\n'), MAX_SOURCE);
}

function readCharting(document: Document, target: Window) {
  const chartGlobal = (target as Window & { Chart?: { version?: string } }).Chart;
  const chartScripts = Array.from(document.scripts)
    .map((script) => script.src)
    .filter((src) => /chart(?:\.min)?\.js/i.test(src));
  const canvases = Array.from(document.querySelectorAll('canvas'))
    .map((canvas) => canvas.id || '(unnamed canvas)');
  return [
    `Chart.js global: ${chartGlobal ? `available${chartGlobal.version ? ` (version ${chartGlobal.version})` : ''}` : 'not detected'}`,
    `Chart.js scripts: ${chartScripts.join(', ') || '(none detected)'}`,
    `Chart canvases: ${canvases.join(', ') || '(none)'}`,
    'Charting guidance: reuse window.Chart and existing canvas ids; prefer Chart.js config objects over inventing Vizx or Nivo APIs.'
  ];
}

function readTrace(document: Document, target: Window) {
  const resourceEntries = target.performance?.getEntriesByType('resource') ?? [];
  const failedNetworkSignals = resourceEntries
    .filter((entry) => entry.duration === 0 && entry.name)
    .slice(-12)
    .map((entry) => `resource not confirmed: ${entry.name}`);
  return [
    `captured: ${new Date().toISOString()}`,
    `document: ${document.documentElement.outerHTML.length} HTML characters, ${document.querySelectorAll('*').length} elements`,
    `scripts: ${document.scripts.length}, stylesheets: ${document.styleSheets.length}, iframes: ${document.querySelectorAll('iframe').length}, canvases: ${document.querySelectorAll('canvas').length}`,
    `performance resources observed: ${resourceEntries.length}`,
    ...failedNetworkSignals
  ];
}

function readEnvironment(target: Window) {
  const locale = target.navigator?.language;
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    // Locale and timezone are optional browser context.
  }
  return [
    locale ? `Browser locale: ${locale}` : '',
    timeZone ? `Browser time zone: ${timeZone}` : ''
  ].filter(Boolean);
}

function readArchitecture(document: Document) {
  return Array.from(document.querySelectorAll('body > *, main > *, section, nav, form, [data-page-region]'))
    .slice(0, 80)
    .map((element) => {
      const id = element.id ? `#${element.id}` : '';
      const classes = typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).map((name) => `.${name}`).join('')
        : '';
      const role = element.getAttribute('role') ? ` role=${element.getAttribute('role')}` : '';
      return `<${element.tagName.toLowerCase()}${id}${classes}${role}>`;
    });
}

export function readPageContext(includeSource = false): PageContext {
  const target = window.parent;
  const document = target.document;
  const capture = installConsoleCapture(target);
  const scripts = Array.from(document.scripts).map((script, index) => {
    if (script.src) return `// external script ${index + 1}: ${script.src}`;
    if (!includeSource) return `// inline script ${index + 1}: ${(script.textContent || '').trim().split('\n')[0] || '(empty)'}`;
    return `// inline script ${index + 1}\n${script.textContent || ''}`;
  }).join('\n\n');
  const structure = Array.from(document.querySelectorAll('nav, h1, h2, h3, section, form, iframe, canvas'))
    .map((element) => `<${element.tagName.toLowerCase()}${element.id ? ` id="${element.id}"` : ''}> ${element.textContent?.trim().slice(0, 100) || ''}`)
    .join('\n');

  return {
    title: document.title,
    path: target.location.pathname,
    visibleText: clip(document.body.innerText.replace(/\s+/g, ' ').trim(), MAX_TEXT),
    html: includeSource ? clip(redactFormValues(document.documentElement.outerHTML), MAX_SOURCE) : structure,
    architecture: readArchitecture(document),
    javascript: clip(scripts, MAX_SOURCE),
    styles: readStyles(document, includeSource),
    console: capture.entries.slice(-20),
    diagnostics: capture.entries.filter((entry) => /error|rejection|failed|not confirmed/i.test(entry)).slice(-20),
    trace: readTrace(document, target),
    charting: readCharting(document, target),
    environment: readEnvironment(target)
  };
}

export function pageContextPrompt(context: PageContext) {
  return pageContextPromptWithOptions(context);
}

function compact(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}\n...[section clipped]` : value;
}

export function pageContextPromptWithOptions(context: PageContext, options: PageContextPromptOptions = {}) {
  const sections = [
    'Use only the explicitly attached browser evidence below. Do not infer missing page facts.'
  ];
  if (options.includeSnapshot !== false) {
    sections.push(
      `Page: ${context.title} (${context.path})`,
      `Visible page text:\n${compact(context.visibleText, 1700)}`,
      `Page structure:\n${compact(context.html, 1200)}`,
      `Observed page architecture:\n${compact(context.architecture.join('\n') || '(none)', 1200)}`,
      `Charting setup:\n${context.charting.join('\n')}`
    );
  }
  if (options.includeSource) {
    sections.push(`JavaScript and CSS source:\n${compact(`${context.javascript}\n\n${context.styles}`, 1800)}`);
  }
  if (options.includeDiagnostics) {
    sections.push(`Runtime diagnostics:\n${compact(context.diagnostics.join('\n') || '(none captured)', 700)}`);
  }
  if (options.includeTrace) {
    sections.push(`Page trace:\n${compact(context.trace.join('\n'), 700)}`);
  }
  if (options.includeConsole) {
    sections.push(`Captured console events:\n${compact(context.console.join('\n') || '(none captured)', 700)}`);
  }
  if (options.includeEnvironment) {
    sections.push(`Browser environment:\n${context.environment.join('\n') || '(not available)'}`);
  }
  return sections.join('\n\n');
}

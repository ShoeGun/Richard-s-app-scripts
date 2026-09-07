import React from 'react';

import { AnalysisResultView } from '../components/AnalysisResultView';
import { createAnalyticsClient } from '../lib/analytics';
import {
  ANALYTICS_HOTSHOT_CONTAINER,
  CAPABILITY_PACK_HUB_URL,
  capabilityContainerPrompt,
  capabilityContainerReceipt
} from '../lib/capability-container';
import type { AnalysisResult } from '../lib/deterministic-analysis';
import { faceDataFromAnalysis } from '../lib/face-data';
import { fetchGoogleSheet } from '../lib/google-sheets';
import { browserModelForCurrentDevice, isMobileBrowser, LocalAiClient, WEBGPU_FAILURE_STORAGE_KEY } from '../lib/local-ai';
import { parseModelPlan } from '../lib/model-plan';
import { pageContextPromptWithOptions, readPageContext, type PageContext, type PageContextPromptOptions } from '../lib/page-context';
import { applyPageAction, inferExplicitPageAction, parsePageAction, type PageAction, type PageActionReceipt } from '../lib/page-tools';
import { publicModelForProfile, shortModelRevision } from '../lib/public-model-registry';
import { setAgentPresence } from '../lib/agent-presence';
import { exposeReactionLibrary, reactionLibraryPrompt } from '../lib/reaction-library';
import { createTrainingExample, readTrainingExamples, saveTrainingExample, trainingExamplesJsonl, type DomTrainingTarget } from '../lib/training-capture';
import type { UploadedDataset } from '../lib/upload';
import type { SchemaColumn } from '../workers/analytics.types';
import { BROWSER_MODEL_ID, type ModelDevice, type ModelWorkerResponse } from '../workers/model.types';

type DatasetState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; source: string; schema: SchemaColumn[] }
  | { status: 'error'; message: string };

type AgentState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'loading'; progress: number | null; loaded: number | null; total: number | null }
  | { status: 'ready'; output: string; result?: AnalysisResult }
  | { status: 'generating'; output: string }
  | { status: 'executing'; output: string }
  | { status: 'error'; message: string };

type AgentMode = 'analysis' | 'page';

const defaultPrompt = 'Group the rows by region, count them, sort the count descending, and show a bar chart.';
const MAX_INFERENCE_PROMPT_CHARS = 3200;

function boundInferencePrompt(value: string) {
  if (value.length <= MAX_INFERENCE_PROMPT_CHARS) return value;
  const tailLength = 700;
  return `${value.slice(0, MAX_INFERENCE_PROMPT_CHARS - tailLength)}\n...[page context clipped to keep local inference reliable]...\n${value.slice(-tailLength)}`;
}

function rememberedSheetUrl() {
  try {
    return window.localStorage.getItem('shoegun-google-sheet-url') || '';
  } catch {
    return '';
  }
}

function planningPrompt(request: string, schema: SchemaColumn[], capabilityContext = '') {
  const columns = schema.length > 0
    ? schema.map((column) => `${column.name} (${column.type})`).join(', ')
    : 'id (number), name (text), age (number), salary (number)';
  return [
    'You are Dom, Richard\'s browser-based hype man and local assistant in development.',
    'You are a temporary small model, not yet the final trained Dom system. Be clear that richer project memory and isolated consultation scheduling are planned future capabilities.',
    'Your personality is curious, warm, concise, energetic, and lightly mischievous. Hype Richard\'s work like a good guide, but never make up credentials, results, or capabilities.',
    'Return only valid JSON. Never return SQL, JavaScript, markdown, commentary, or unsupported keys.',
    'Allowed keys: filters, groupBy, aggregations, sort, limit, chart.',
    'Allowed aggregations: count, sum, avg, min, max. Allowed charts: table, bar, line, scatter, auto.',
    'Use only exact column names from Available columns. If no categorical column fits the request, omit groupBy. For row counts use an aggregation with operator count and no field. A sort field must be an exact source column or aggregation alias.',
    `Available columns: ${columns}.`,
    capabilityContext,
    `User request: ${request}`
  ].filter(Boolean).join('\n');
}

function isIdentityQuestion(request: string) {
  return /\bwho\s+is\s+richard\b|\btell\s+me\s+about\s+richard\b|\bwhat\s+does\s+richard\s+do\b/i.test(request);
}

function isCapabilityQuestion(request: string) {
  return /\b(?:who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+other\s+tools|what\s+tools\s+do\s+you\s+have|what\s+are\s+your\s+tools)\b/i.test(request);
}

function isGreeting(request: string) {
  return /^(?:hi|hey|hello|yo|sup)(?:\s+dom)?[\s!,.?]*$/i.test(request.trim());
}

function isDataConnectionQuestion(request: string) {
  return /\b(?:is|are|do you have|did you connect|what(?:'s| is))\b.*\b(?:data|sheet|spreadsheet|dataset)\b|\b(?:data|sheet|spreadsheet|dataset)\b.*\b(?:connected|attached|linked|available)\b/i.test(request);
}

function isReceiptQuestion(request: string) {
  return /\b(?:approve|approved|did it run|did that run|was it applied|has it run)\b/i.test(request)
    && /\b(?:console|action|edit|change|run|apply|applied)\b/i.test(request);
}

function isFaceDataQuestion(request: string) {
  return /\bface\b[\s\S]*\b(?:bundled|loaded|demo)\s+data\b|\b(?:bundled|loaded|demo)\s+data\b[\s\S]*\bface\b/i.test(request);
}

function isDataMutationBoundaryQuestion(request: string) {
  return /\b(?:change|edit|modify|write|update)\b[\s\S]*\b(?:bundled|demo|loaded)\s+data\b/i.test(request);
}

function isUnloadQuestion(request: string) {
  return /\b(?:unload|free|dispose|clear)\b[\s\S]*\b(?:dom|model|memory)\b/i.test(request);
}

function isProjectWalkthroughQuestion(request: string) {
  return /\b(?:walk me through|explain|tell me about|what problem|what is the point|why is)\b[\s\S]*\b(?:project|henry|kepler|altitude)\b/i.test(request);
}

function isProjectOverviewQuestion(request: string) {
  return /\bwhat projects\b[\s\S]*\b(?:walk|show|explore)\b|\bshow me the featured projects\b/i.test(request);
}

function isProjectComparisonQuestion(request: string) {
  return /\b(?:how are|compare|difference|different)\b[\s\S]*\b(?:three|projects|featured)\b/i.test(request);
}

function isDemoDataRequest(request: string) {
  return /\b(?:use|try|load|show|open|connect)\b[\s\S]*\b(?:bundled|demo|example)\b[\s\S]*\b(?:data|dataset|example)?\b/i.test(request)
    || /\bbundled\s+(?:demo|example)\b/i.test(request);
}

function isAnalysisRequest(request: string) {
  return /\b(?:analy[sz]e|count|average|avg|sum|minimum|min|max(?:imum)?|compare|sort|group|chart|graph|rows?|categories?|regions?|projects?)\b/i.test(request);
}

function minimalPagePrompt(request: string) {
  return `User request: ${request}`;
}

const identityAnswer = 'Richard Jones is an analytics and AI integration consultant, data engineer, analyst, and full-stack developer. His experience includes six years at Uber with machine-learning work and backend analytics tables built with Hive, lead engineering at Reciprocity Health, government-contractor work through Vangent supporting the CDC, banking work with Bank of America and JPMorgan Chase, and legal-technology and paralegal work. He helps clients turn messy data, practical AI, and web systems into useful business tools.';
const greetingAnswer = 'Hey. I\'m Dom, Richard\'s browser-based assistant. I can explain the work on this page, help you connect a public sheet, or suggest a useful chart or project to explore.';
const capabilityAnswer = 'I am Dom, the assistant embedded in this portfolio. I can answer questions about Richard and this page, use the live page console for HTML, CSS, and JavaScript edits, find or remove described divs, change page colors, make elements jiggle or stop, inspect the live DOM, reset edits, trigger fireworks or a hotdog-rain overlay, animate my face, let my face reflect loaded analysis values, load the bundled demo data, present project cards, connect a public sheet, and run bounded local analysis. I report what the page actually did instead of pretending an action succeeded.';
const faceDataAnswer = 'After a local analysis, my eyes and mouth can reflect normalized numeric result values, while the status names the result row count and chart type. It is a compact visual summary, not a claim that I understand data that was never loaded.';
const dataBoundaryAnswer = 'I can analyze the bundled data locally, but this page does not write changes back to the source. I can help filter, group, sort, aggregate, and chart the loaded snapshot.';
const unloadAnswer = 'No. The portfolio disposes the in-memory model when its tab or window is refreshed, closed, or unloaded; cached model files may remain available for the next visit.';
const projectOverviewAnswer = "I can walk you through Henry's Super Scoops CMS, Kepler in a Google Web App, and the Altitude Directions App. Ask for one by name and I can explain its purpose, the problem it demonstrates, and open its project view for you.";
const projectCompareAnswer = "Henry's Super Scoops focuses on small-business scheduling, Kepler focuses on geospatial data and interactive mapping, and Altitude Directions focuses on safety-aware route planning. Together they show practical work across workflow automation, data visualization, and decision support.";

type FaceMood = 'curious' | 'happy' | 'alert' | 'wonder' | 'thinking' | 'surprised' | 'concerned' | 'sleepy' | 'celebrate';

type ContextControls = PageContextPromptOptions & {
  includeTourFocus: boolean;
};

function faceMoodForPrompt(prompt: string): FaceMood {
  if (/error|fail|broken|wrong|problem|can't|cannot/i.test(prompt)) return 'concerned';
  if (/wow|amazing|celebrat|great|love|excellent/i.test(prompt)) return 'celebrate';
  if (/how|why|explain|what|tell me|describe/i.test(prompt)) return 'thinking';
  if (/show|demonstrate|look|see|visual|chart|timeline/i.test(prompt)) return 'wonder';
  if (/surpris|really|serious|urgent/i.test(prompt)) return 'surprised';
  return 'curious';
}

function postFaceMood(mood: FaceMood) {
  window.parent.postMessage({ type: 'shoegun-dom-face-mood', mood }, '*');
}

function postFaceData(data: ReturnType<typeof faceDataFromAnalysis>) {
  window.parent.postMessage({ type: 'shoegun-dom-face-data', data }, '*');
}

function postFaceSpeech(text: string, done = false) {
  window.parent.postMessage({ type: 'shoegun-dom-face-speech', text, done }, '*');
}

const AgentApp = () => {
  const mobileBrowser = isMobileBrowser();
  const browserModel = browserModelForCurrentDevice();
  const publicModel = publicModelForProfile(browserModel.profile);
  const [sheetUrl, setSheetUrl] = React.useState(rememberedSheetUrl);
  const [dataset, setDataset] = React.useState<UploadedDataset | null>(null);
  const [datasetState, setDatasetState] = React.useState<DatasetState>({ status: 'empty' });
  const [agent, setAgent] = React.useState<AgentState>({ status: 'idle' });
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [mode, setMode] = React.useState<AgentMode>('page');
  const [pageContext, setPageContext] = React.useState<PageContext | null>(null);
  const [tourFocus, setTourFocus] = React.useState<string | null>(null);
  const [contextControls, setContextControls] = React.useState<ContextControls>({
    includeSnapshot: false,
    includeDiagnostics: false,
    includeTrace: false,
    includeConsole: false,
    includeEnvironment: false,
    includeTourFocus: false,
  });
  const [pendingAction, setPendingAction] = React.useState<PageAction | null>(null);
  const [actionReceipt, setActionReceipt] = React.useState<PageActionReceipt | null>(null);
  const [pageCode, setPageCode] = React.useState('');
  const [modelDevice, setModelDevice] = React.useState<ModelDevice | null>(null);
  const [trainingAnswer, setTrainingAnswer] = React.useState('');
  const [trainingCaptureCount, setTrainingCaptureCount] = React.useState(() => readTrainingExamples().length);
  const [trainingCaptureStatus, setTrainingCaptureStatus] = React.useState('');
  const [loadNotice, setLoadNotice] = React.useState('');
  const [capabilityActive, setCapabilityActive] = React.useState(false);
  const aiClient = React.useRef<LocalAiClient | null>(null);
  const modeRef = React.useRef<AgentMode>('analysis');
  const runAgentRef = React.useRef<((request: string, requestedMode: AgentMode) => void) | null>(null);
  const unloadModel = React.useCallback((notice = 'Dom unloaded to free browser memory. Cached model files remain available.') => {
    aiClient.current?.dispose();
    aiClient.current = null;
    setModelDevice(null);
    setLoadNotice(notice);
    setAgent({ status: 'idle' });
  }, []);

  React.useEffect(() => {
    exposeReactionLibrary();
    const handleTourContext = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: unknown; message?: unknown }>).detail;
      const title = typeof detail?.title === 'string' ? detail.title : '';
      const message = typeof detail?.message === 'string' ? detail.message : '';
      if (title || message) setTourFocus([title, message].filter(Boolean).join(': '));
    };
    const handleSheetFocus = (event: MessageEvent<{ type?: unknown; url?: unknown }>) => {
      if (event.data?.type !== 'shoegun-focus-sheet') return;
      const details = document.querySelector<HTMLDetailsElement>('.context-card');
      const input = document.getElementById('sheet-url') as HTMLInputElement | null;
      if (!input) return;
      const url = typeof event.data.url === 'string' ? event.data.url : '';
      if (details) details.open = true;
      if (url) setSheetUrl(url);
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
    };
    window.addEventListener('shoegun-agent-tour-context', handleTourContext);
    window.addEventListener('message', handleSheetFocus);
    const reportHeight = () => {
      window.parent.postMessage({
        type: 'shoegun-browser-agent-height',
        height: Math.ceil(document.documentElement.scrollHeight)
      }, '*');
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reportHeight);
    resizeObserver?.observe(document.body);
    reportHeight();
     const handlePageHide = () => {
       aiClient.current?.dispose();
       aiClient.current = null;
     };
     window.addEventListener('pagehide', handlePageHide);
     window.addEventListener('beforeunload', handlePageHide);
     return () => {
      window.removeEventListener('shoegun-agent-tour-context', handleTourContext);
      window.removeEventListener('message', handleSheetFocus);
      resizeObserver?.disconnect();
      window.removeEventListener('pagehide', handlePageHide);
       window.removeEventListener('beforeunload', handlePageHide);
      aiClient.current?.dispose();
      aiClient.current = null;
    };
  }, [unloadModel]);

  const inspectDataset = async (nextDataset: UploadedDataset, source: string) => {
    const client = createAnalyticsClient();
    setDatasetState({ status: 'loading' });
    try {
      await client.loadUploadedDataset(nextDataset);
      const schema = await client.inspectSchema();
      setDataset(nextDataset);
      setDatasetState({ status: 'ready', source, schema });
      return schema;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDatasetState({ status: 'error', message });
      throw error;
    } finally {
      client.dispose();
    }
  };

  const connectSheet = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const nextDataset = await fetchGoogleSheet(sheetUrl);
      await inspectDataset(nextDataset, 'Google Sheet');
      try {
        window.localStorage.setItem('shoegun-google-sheet-url', sheetUrl.trim());
      } catch {
        // Local storage is optional for private browsing sessions.
      }
    } catch (error) {
      setDatasetState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const loadDemo = async () => {
    try {
      const demoUrl = new URL('../data/demo.csv', new URL(import.meta.env.BASE_URL, window.location.origin)).href;
      const response = await fetch(demoUrl);
      if (!response.ok) throw new Error(`Demo dataset returned HTTP ${response.status}.`);
      return await inspectDataset({ fileName: 'demo.csv', format: 'csv', content: await response.text() }, 'Bundled demo');
    } catch (error) {
      setDatasetState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const executePlan = async (raw: string) => {
    setAgent({ status: 'executing', output: raw });
    const client = createAnalyticsClient();
    try {
      const plan = parseModelPlan(raw);
      if (dataset) await client.loadUploadedDataset(dataset);
      else await client.loadDataset();
      const result = await client.executePlan(plan);
      setAgent({ status: 'ready', output: JSON.stringify(plan, null, 2), result });
      postFaceData(faceDataFromAnalysis(result));
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      client.dispose();
    }
  };

  const onModelMessage = (message: ModelWorkerResponse) => {
    if (message.type === 'model-progress') {
      setAgent({ status: 'loading', progress: message.progress, loaded: message.loaded, total: message.total });
    } else if (message.type === 'model-status') {
      if (/switching to cpu webassembly/i.test(message.message)) {
        try { window.localStorage.setItem(WEBGPU_FAILURE_STORAGE_KEY, '1'); } catch { /* optional browser storage */ }
      }
      setLoadNotice(message.message);
    } else if (message.type === 'model-ready') {
      setModelDevice(message.device);
      setLoadNotice('');
      setAgent({ status: 'ready', output: '' });
       postFaceMood('happy');
    } else if (message.type === 'generation-started') {
      window.dispatchEvent(new CustomEvent('shoegun-agent-chat-status', { detail: { busy: true, message: 'Dom is thinking locally...' } }));
      postFaceMood('thinking');
      postFaceSpeech('');
      setAgent({ status: 'generating', output: '' });
    } else if (message.type === 'generation-chunk') {
      postFaceSpeech(message.text);
      setAgent((current) => ({ status: 'generating', output: `${current.status === 'generating' ? current.output : ''}${message.text}` }));
    } else if (message.type === 'generation-complete') {
      postFaceSpeech('', true);
      setTrainingAnswer(message.text);
      if (modeRef.current === 'page') {
        setPendingAction(parsePageAction(message.text));
        setAgent({ status: 'ready', output: message.text });
         postFaceMood('happy');
        window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: message.text } }));
      }
      else {
        postFaceMood('happy');
        void executePlan(message.text);
      }
    } else if (message.type === 'model-error') {
      window.dispatchEvent(new CustomEvent('shoegun-agent-chat-status', { detail: { busy: false, message: `Dom hit a local model error: ${message.message}` } }));
      postFaceMood('concerned');
      if (/bad_alloc|bad alloc|failed to allocate|allocate a buffer|can't create a session|cannot create a session|out of memory/i.test(message.message)) {
        aiClient.current?.dispose();
        aiClient.current = null;
      }
      setAgent({ status: 'error', message: message.message });
    }
  };

  const launchModel = async () => {
    setAgent({ status: 'checking' });
    setModelDevice(null);
    setLoadNotice('');
    aiClient.current ??= new LocalAiClient(onModelMessage);
    try {
      await aiClient.current.load();
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const cancelDownload = () => {
    aiClient.current?.cancelLoad();
    unloadModel('Dom loading cancelled. Cached model files remain available.');
  };

  const runAgent = (requestedPrompt = prompt, requestedMode = mode) => {
    try {
      if (modelReady) postFaceMood(faceMoodForPrompt(requestedPrompt));
      const schema = datasetState.status === 'ready' ? datasetState.schema : [];
      const activeCapabilityPrompt = capabilityActive ? capabilityContainerPrompt(ANALYTICS_HOTSHOT_CONTAINER) : '';
      const hasToolContext = contextControls.includeDiagnostics || contextControls.includeTrace || contextControls.includeConsole || contextControls.includeEnvironment;
      const context = requestedMode === 'page' && hasToolContext ? readPageContext(false) : null;
      if (context) setPageContext(context);
      if (requestedMode === 'page') {
        if (isDemoDataRequest(requestedPrompt)) {
          setPendingAction(null);
          setMode('analysis');
          modeRef.current = 'analysis';
          setAgent({ status: 'executing', output: 'Loading the bundled portfolio demo data...' });
          void loadDemo().then((schema) => {
            if (!schema) return;
            const answer = 'Bundled portfolio demo data is connected locally. Ask me to count projects by category, compare scores, or make a chart.';
            setAgent({ status: 'ready', output: answer });
            setTrainingAnswer(answer);
            postFaceMood('happy');
            postFaceSpeech(answer, true);
          });
          return;
        }
        const explicitAction = inferExplicitPageAction(requestedPrompt);
        if (explicitAction) {
          const receipt = applyPageAction(explicitAction);
          setActionReceipt(receipt);
          setPendingAction(null);
          setPageContext(readPageContext(false));
           const answer = `${receipt.label}. ${receipt.detail}`;
           setAgent({ status: 'ready', output: answer });
           setTrainingAnswer(answer);
           if (!explicitAction.code?.includes('__shoegunDomFace')) postFaceMood('happy');
           postFaceSpeech(answer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: answer } }));
          return;
        }
        if (isAnalysisRequest(requestedPrompt)) {
          const schema = datasetState.status === 'ready' ? datasetState.schema : [];
          setMode('analysis');
          modeRef.current = 'analysis';
          aiClient.current?.generate(boundInferencePrompt(planningPrompt(requestedPrompt, schema, activeCapabilityPrompt)), 'analysis');
          return;
        }
        if (isIdentityQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: identityAnswer });
          setTrainingAnswer(identityAnswer);
          postFaceSpeech(identityAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: identityAnswer } }));
          return;
        }
        if (isCapabilityQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: capabilityAnswer });
          setTrainingAnswer(capabilityAnswer);
          postFaceMood('happy');
          postFaceSpeech(capabilityAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: capabilityAnswer } }));
          return;
        }
        if (isReceiptQuestion(requestedPrompt)) {
          const answer = 'Approval is recorded, but I cannot say the page action ran until the portfolio host returns a receipt.';
          setPendingAction(null);
          setAgent({ status: 'ready', output: answer });
          setTrainingAnswer(answer);
          postFaceMood('happy');
          postFaceSpeech(answer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: answer } }));
          return;
        }
        if (isFaceDataQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: faceDataAnswer });
          setTrainingAnswer(faceDataAnswer);
          postFaceMood('happy');
          postFaceSpeech(faceDataAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: faceDataAnswer } }));
          return;
        }
        if (isDataMutationBoundaryQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: dataBoundaryAnswer });
          setTrainingAnswer(dataBoundaryAnswer);
          postFaceMood('happy');
          postFaceSpeech(dataBoundaryAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: dataBoundaryAnswer } }));
          return;
        }
        if (isUnloadQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: unloadAnswer });
          setTrainingAnswer(unloadAnswer);
          postFaceMood('happy');
          postFaceSpeech(unloadAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: unloadAnswer } }));
          return;
        }
        if (isProjectOverviewQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: projectOverviewAnswer });
          setTrainingAnswer(projectOverviewAnswer);
          postFaceMood('happy');
          postFaceSpeech(projectOverviewAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: projectOverviewAnswer } }));
          return;
        }
        if (isProjectComparisonQuestion(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: projectCompareAnswer });
          setTrainingAnswer(projectCompareAnswer);
          postFaceMood('happy');
          postFaceSpeech(projectCompareAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: projectCompareAnswer } }));
          return;
        }
        if (isProjectWalkthroughQuestion(requestedPrompt)) {
          const answer = /henry/i.test(requestedPrompt)
            ? "Henry's Super Scoops is a streamlined CMS concept built around Google Sheets and Apps Script. It demonstrates appointment automation, resource allocation, and Calendar-oriented workflow for a small dessert-themed business."
            : /kepler/i.test(requestedPrompt)
              ? 'Kepler in a Google Web App demonstrates how Kepler.gl can be extended inside Google Web Apps. It loads data dynamically from Sheets and presents interactive mapping for geospatial analysis; I can open the project view and a visitor-supplied public Sheet side by side.'
              : 'The Altitude Directions App is a route-planning tool for altitude-sensitive situations. It considers thresholds, assisting divers, and altitude-sensitive users so route choices can be safer and more efficient.';
          setPendingAction(null);
          setAgent({ status: 'ready', output: answer });
          setTrainingAnswer(answer);
          postFaceMood('happy');
          postFaceSpeech(answer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: answer } }));
          return;
        }
        if (isGreeting(requestedPrompt)) {
          setPendingAction(null);
          setAgent({ status: 'ready', output: greetingAnswer });
          setTrainingAnswer(greetingAnswer);
          postFaceMood('happy');
          postFaceSpeech(greetingAnswer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: greetingAnswer } }));
          return;
        }
        if (isDataConnectionQuestion(requestedPrompt)) {
          const answer = datasetState.status === 'ready'
            ? `${datasetState.source} is connected locally with ${datasetState.schema.length} columns available. Dom can use it for a bounded analysis, but the page never writes back to the source.`
            : 'No sheet or bundled demo is connected yet. Use Connect data above to add a public sheet, or choose the bundled example.';
          setPendingAction(null);
          setAgent({ status: 'ready', output: answer });
          setTrainingAnswer(answer);
          postFaceMood('happy');
          postFaceSpeech(answer, true);
          window.dispatchEvent(new CustomEvent('shoegun-agent-chat-response', { detail: { message: answer } }));
          return;
        }
      }
      modeRef.current = requestedMode;
      const memoryContext = activeCapabilityPrompt ? `\n\n${activeCapabilityPrompt}` : '';
      const pagePrompt = requestedMode === 'page'
        ? context
          ? `${pageContextPromptWithOptions(context, { ...contextControls, includeSnapshot: false, includeSource: false })}${contextControls.includeTourFocus && tourFocus ? `\n\nTour focus selected by the visitor: ${tourFocus.slice(0, 300)}` : ''}${memoryContext}\n\nUser request: ${requestedPrompt}`
          : `${minimalPagePrompt(requestedPrompt)}${memoryContext}`
        : planningPrompt(requestedPrompt, schema, activeCapabilityPrompt);
      aiClient.current?.generate(
        boundInferencePrompt(pagePrompt),
        requestedMode
      );
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const applyPendingAction = () => {
    if (!pendingAction) return;
    try {
      setActionReceipt(applyPageAction(pendingAction));
      setPendingAction(null);
      setPageContext(readPageContext(false));
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const runPageCode = () => {
    try {
      const receipt = applyPageAction({ kind: 'javascript', label: 'Run page tool console code', code: pageCode });
      setActionReceipt(receipt);
      setPageCode('');
      setPageContext(readPageContext(false));
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const modelBusy = agent.status === 'generating' || agent.status === 'executing';
  const modelReady = modelDevice !== null;
  runAgentRef.current = runAgent;

  React.useEffect(() => {
    window.parent.postMessage({ type: 'shoegun-browser-agent-state', state: modelReady ? 'ready' : 'idle' }, '*');
  }, [modelReady]);

  React.useEffect(() => {
    if (!modelReady) return undefined;
    let context = pageContext;
    if (!context) {
      try {
        context = readPageContext(false);
      } catch {
        // The parent page may still be settling during a direct preview.
      }
    }
    return setAgentPresence({ context: context ?? undefined });
  }, [modelReady]);

  React.useEffect(() => {
    if (!modelReady) return undefined;
    const handlePresenceChat = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown }>).detail;
      const text = typeof detail?.text === 'string' ? detail.text.trim() : '';
      if (!text) return;
      setMode('page');
      modeRef.current = 'page';
      setPrompt(text);
      runAgentRef.current?.(text, 'page');
    };
    window.addEventListener('shoegun-agent-chat', handlePresenceChat);
    return () => window.removeEventListener('shoegun-agent-chat', handlePresenceChat);
  }, [modelReady]);

  const inspectPage = () => {
    try {
      setPageContext(readPageContext(false));
      setContextControls((current) => ({ ...current, includeDiagnostics: true, includeConsole: true }));
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const tracePage = () => {
    try {
      setPageContext(readPageContext(false));
      setContextControls((current) => ({ ...current, includeTrace: true }));
    } catch (error) {
      setAgent({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const buildPagePromptPreview = (context: PageContext | null) => {
    const memoryContext = capabilityActive ? `\n\n${capabilityContainerPrompt(ANALYTICS_HOTSHOT_CONTAINER)}` : '';
    if (!context) return boundInferencePrompt(`${minimalPagePrompt('(preview: no question yet)')}${memoryContext}`);
    const hasToolContext = contextControls.includeDiagnostics || contextControls.includeTrace || contextControls.includeConsole || contextControls.includeEnvironment;
    const prompt = hasToolContext
      ? `${pageContextPromptWithOptions(context, { ...contextControls, includeSnapshot: false, includeSource: false })}${contextControls.includeTourFocus && tourFocus ? `\n\nTour focus:\n${tourFocus.slice(0, 300)}` : ''}${memoryContext}`
      : `${minimalPagePrompt('(preview: no question yet)')}${memoryContext}`;
    return boundInferencePrompt(prompt);
  };
  const activeCapabilityReceipt = capabilityContainerReceipt(ANALYTICS_HOTSHOT_CONTAINER);
  const trainingTarget: DomTrainingTarget = mobileBrowser ? 'mobile' : modelDevice === 'webgpu' ? 'desktop-gpu' : 'desktop-cpu';
  const saveCurrentTrainingExample = () => {
    try {
      const currentOutput = 'output' in agent ? agent.output : '';
      const example = createTrainingExample({ request: prompt, response: trainingAnswer || currentOutput, target: trainingTarget });
      const examples = saveTrainingExample(example);
      setTrainingCaptureCount(examples.length);
      setTrainingCaptureStatus(`Saved reviewed example for ${trainingTarget}.`);
    } catch (error) {
      setTrainingCaptureStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const downloadTrainingPack = () => {
    const examples = readTrainingExamples();
    if (!examples.length) {
      setTrainingCaptureStatus('Save one reviewed exchange first.');
      return;
    }
    const blob = new Blob([trainingExamplesJsonl(examples)], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dom-browser-tests-${new Date().toISOString().slice(0, 10)}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
    setTrainingCaptureStatus(`Downloaded ${examples.length} reviewed examples.`);
  };
  const pagePromptPreview = buildPagePromptPreview(pageContext);
  const toggleContextControl = (key: keyof ContextControls) => {
    setContextControls((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <main className="agent-page">
      <header className="agent-header">
        <h1>Local Browser Model</h1>
        {agent.status === 'idle' && <button className="primary-button activation-button" type="button" onClick={launchModel}>Activate Dom and download the {mobileBrowser ? 'mobile' : 'local'} model</button>}
      </header>

      <details className={`agent-card context-card ${modelReady ? 'unlocked' : 'locked'}`} open={false} aria-labelledby="data-title">
        <summary className="agent-card-heading"><div><h2 id="data-title">Connect data</h2><p>Optional: use a public sheet or the bundled demo.</p></div></summary>
        <div className="context-body">
          <form className="sheet-form" onSubmit={connectSheet}>
            <label htmlFor="sheet-url">Public or published Google Sheet</label>
            <div className="input-row"><input id="sheet-url" type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." required /><button type="submit" disabled={datasetState.status === 'loading'}>{datasetState.status === 'loading' ? 'Reading...' : 'Connect sheet'}</button></div>
          </form>
          <details className="data-access-note"><summary>Access note</summary><p>The sheet must be public or published to the web. This static page reads a snapshot only; it does not request Google login or write back.</p></details>
          <button className="secondary-button" type="button" onClick={loadDemo} disabled={datasetState.status === 'loading'}>Try the bundled example</button>
          {datasetState.status === 'error' && <p className="error" role="alert">{datasetState.message}</p>}
          {datasetState.status === 'ready' && <div className="ready" role="status"><strong>{datasetState.source} connected.</strong><span>{datasetState.schema.length} columns available to the agent.</span></div>}
          {datasetState.status === 'ready' && <details className="stored-examples"><summary>See the local examples Dom can run</summary><ul><li>Compare request volume by region.</li><li>Track resolution rate over time.</li><li>Explain which channel has the strongest satisfaction score.</li></ul><p>These calculations run deterministically in the browser after Dom proposes a validated plan.</p></details>}
        </div>
      </details>

      <section className={`agent-card model-card ${modelReady ? 'unlocked' : ''}`} aria-labelledby="model-title">
        {!modelReady && <div className="agent-card-heading"><div><h2 id="model-title">Activate Dom</h2><p>Press once to load Dom into this browser. His compact chat opens automatically when he is ready.</p><details className="model-disclosure"><summary>About this prototype</summary><p>This temporary browser model stays in the browser cache when the environment permits, so later visits may skip the download.</p><p className="model-note">Current public profile: <a href={publicModel.hubUrl} target="_blank" rel="noreferrer">{browserModel.id}</a> @ {shortModelRevision(browserModel.revision)} ({publicModel.quantization}). {mobileBrowser ? 'This trained model downloads about 770 MB and needs sufficient free memory on mobile.' : `The desktop profile uses ${BROWSER_MODEL_ID}.`} The deployment gate verifies this exact public revision and its required browser artifacts before publishing.</p><p className="model-note">Dom is being shaped around Richard&apos;s experience organizing documents and building AI tools that helped defend innocent litigants, as well as running global analytics at Uber.</p><div className="reaction-library"><strong>Keyless reaction library</strong><span>Dom can reference a small Giphy search catalog without putting an API key in this static site.</span><pre>{reactionLibraryPrompt()}</pre></div></details></div></div>}
        {!modelReady && <p className="mode-note">Download the model first; these modes unlock when it is ready.</p>}
        <details className="page-tools-disclosure">
          <summary>Add one optional test input</summary>
          <p>Dom starts with no page, data, memory, trace, or console context. Add only one input when you are deliberately testing that capability.</p>
          <div className="page-tools">
            <button className="secondary-button" type="button" onClick={inspectPage}>Prepare console diagnostics</button>
            <button className="secondary-button" type="button" onClick={tracePage}>Prepare page trace</button>
            {pageContext && <span role="status">Tool evidence prepared for the next test.</span>}
          </div>
        </details>
        {pageContext && <details className="page-context"><summary>View live trace and diagnostics</summary><p><strong>{pageContext.title}</strong> · {pageContext.path}</p><h3>Diagnostics</h3><pre>{pageContext.diagnostics.join('\n') || '(no runtime errors captured yet)'}</pre><h3>Charting</h3><pre>{pageContext.charting.join('\n')}</pre><h3>Trace</h3><pre>{pageContext.trace.join('\n')}</pre></details>}
        {modelReady && <section className="kv-handoff-ledger" aria-labelledby="kv-handoff-title">
          <div><span className="container-format">KVC1 · raw cache handoff</span><h3 id="kv-handoff-title">Contained-idea pipeline</h3></div>
          <div className="kv-pipeline" aria-label="KV-cache handoff stages"><span className="complete">Define + verify KVC1 bytes</span><span className="pending">Extract and reload a live cache</span><span className="pending">Translate across families</span><span className="pending">Load into Dom + score probes</span></div>
          <p><strong>The intended payload:</strong> actual key/value attention-cache tensors produced after a source model processes an idea. These are runtime activations, not model weights.</p>
          <p><strong>Working now:</strong> atomic byte serialization, inspection, checksum validation, and fail-closed compatibility checks. The accepted tests use deterministic synthetic payload bytes; live runtime extraction and reload remain the next gate.</p>
          <p><strong>Next bridge:</strong> a versioned learned translator must map layers, KV heads, head dimensions, positions, and RoPE semantics before a different family can load the contained idea.</p>
          <p className="experiment-caveat"><strong>Evidence rule:</strong> Dom has not inherited a larger model’s capability until no-cache, text-context, translated-cache, and control-cache probes show a repeatable improvement.</p>
          <a href={CAPABILITY_PACK_HUB_URL} target="_blank" rel="noreferrer">Inspect the KVC1 format and translation contract</a>
        </section>}
        {modelReady && <section className={`capability-container ${capabilityActive ? 'active' : ''}`} aria-labelledby="capability-container-title">
          <div className="capability-container-heading">
            <div><span className="container-format">Sidecar control pack · {ANALYTICS_HOTSHOT_CONTAINER.status}</span><h3 id="capability-container-title">{ANALYTICS_HOTSHOT_CONTAINER.title}</h3></div>
            <button className="secondary-button" type="button" aria-pressed={capabilityActive} onClick={() => setCapabilityActive((current) => !current)}>{capabilityActive ? 'Unload sidecar' : 'Load sidecar'}</button>
          </div>
          <p>{ANALYTICS_HOTSHOT_CONTAINER.purpose}</p>
          <div className="capability-metrics" aria-label="Capability-container footprint">
            <span><strong>{activeCapabilityReceipt.bytes.toLocaleString()}</strong> bytes stored</span>
            <span><strong>≈{activeCapabilityReceipt.estimatedActivationTokens}</strong> prompt tokens active</span>
            <span><strong>{activeCapabilityReceipt.toolCount}</strong> trusted host tools</span>
            <span><strong>{activeCapabilityReceipt.probeCount}</strong> evaluation probes</span>
          </div>
          <p className="context-budget"><strong>Context ledger:</strong> the model architecture advertises {activeCapabilityReceipt.modelContextTokens.toLocaleString()} tokens. This demo separately bounds dynamic request text to {activeCapabilityReceipt.dynamicPromptLimitCharacters.toLocaleString()} characters (roughly 800 tokens) for browser reliability.</p>
          <details><summary>Inspect the handoff</summary><p>{ANALYTICS_HOTSHOT_CONTAINER.sourcePolicy}</p><h4>Injected operating rules</h4><ul>{ANALYTICS_HOTSHOT_CONTAINER.expertBriefing.map((rule) => <li key={rule}>{rule}</li>)}</ul><h4>Capability probes</h4><ol>{ANALYTICS_HOTSHOT_CONTAINER.probes.map((probe) => <li key={probe.id}><strong>{probe.request}</strong><span>{probe.successCriterion}</span></li>)}</ol><a href={CAPABILITY_PACK_HUB_URL} target="_blank" rel="noreferrer">Open the versioned handoff artifact on Hugging Face</a></details>
          <p className="capability-state" role="status">{capabilityActive ? 'Loaded: Dom receives this bounded sidecar with the next request. It is not the raw KV payload.' : 'Unloaded: no sidecar instructions are added to Dom’s prompt.'}</p>
        </section>}
        {modelReady && <details className="context-controls">
          <summary>What Dom sees</summary>
          <p>{contextControls.includeDiagnostics || contextControls.includeTrace || contextControls.includeConsole || contextControls.includeEnvironment ? 'The next request includes only the selected tool evidence. The preview below is the exact bounded reference.' : capabilityActive ? 'Dom gets only the question, the small output contract, and the active capability container.' : 'Dom currently gets no runtime context. The next request contains only the question and the small output contract.'}</p>
          <div className="context-control-grid">
            <label><input type="checkbox" checked={Boolean(contextControls.includeDiagnostics)} onChange={() => toggleContextControl('includeDiagnostics')} /> Runtime diagnostics</label>
            <label><input type="checkbox" checked={Boolean(contextControls.includeTrace)} onChange={() => toggleContextControl('includeTrace')} /> Page trace</label>
            <label><input type="checkbox" checked={Boolean(contextControls.includeConsole)} onChange={() => toggleContextControl('includeConsole')} /> Console events</label>
            <label><input type="checkbox" checked={Boolean(contextControls.includeEnvironment)} onChange={() => toggleContextControl('includeEnvironment')} /> Browser environment</label>
            <label><input type="checkbox" checked={contextControls.includeTourFocus} onChange={() => toggleContextControl('includeTourFocus')} /> Tour focus</label>
          </div>
          <p className="context-size">{pagePromptPreview.length.toLocaleString()} characters after the local prompt bound · capability {capabilityActive ? `≈${activeCapabilityReceipt.estimatedActivationTokens} tokens` : 'unloaded'}.</p>
          <pre className="context-preview">{pagePromptPreview || 'Refresh page context to preview Dom\'s working set.'}</pre>
        </details>}
        {agent.status === 'checking' && <p className="status" role="status">Checking WebGPU and CPU browser support...</p>}
        {loadNotice && <p className="status" role="status">{loadNotice}</p>}
        {agent.status === 'loading' && <div className="download-status" role="status" aria-live="polite"><progress max="100" value={agent.progress ?? undefined} /><span>{agent.progress === null ? 'Preparing model files...' : `${Math.round(agent.progress)}%`} {agent.loaded && agent.total ? `· ${(agent.loaded / 1024 / 1024).toFixed(1)} MB of ${(agent.total / 1024 / 1024).toFixed(1)} MB` : ''}</span><button className="secondary-button" type="button" onClick={cancelDownload}>Cancel download</button></div>}
        {agent.status === 'loading' && <details className="loading-disclosure"><summary>What is loading?</summary><p>A small local model is loading in your browser. It tries WebGPU first, falls back to WebAssembly when needed, and may stay cached for your next visit.</p></details>}
        {agent.status === 'error' && <div><p className="error" role="alert">{agent.message}</p><button className="secondary-button" type="button" onClick={launchModel}>Retry model load</button></div>}
        {(agent.status === 'ready' || agent.status === 'generating' || agent.status === 'executing') && <details className="workspace-details"><summary>Open Dom&apos;s full local workspace</summary><form className="agent-run" onSubmit={(event) => { event.preventDefault(); runAgent(); }}><p className="ready" role="status">Model ready in this browser on {modelDevice === 'wasm' ? 'CPU WebAssembly fallback' : 'WebGPU'}. {mode === 'page' ? 'No page context is attached unless you select one test input above.' : 'Your data stays in this browser.'}</p><label htmlFor="agent-prompt">Ask Dom</label><textarea id="agent-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask one small question at a time." disabled={modelBusy} /><button className="primary-button" type="submit" disabled={modelBusy || !prompt.trim()}>{agent.status === 'generating' ? 'Generating...' : agent.status === 'executing' ? 'Validating and calculating...' : 'Send to Dom'}</button>{agent.output && <output>{agent.output}</output>}{agent.output && mode === 'page' && <details className="training-capture"><summary>Review this test as training data</summary><p>Edit the answer until it is correct, then save it for the selected browser target. Nothing is uploaded.</p><textarea aria-label="Approved training answer" rows={4} value={trainingAnswer} onChange={(event) => setTrainingAnswer(event.target.value)} /><div className="training-actions"><button className="secondary-button" type="button" onClick={saveCurrentTrainingExample}>Save reviewed example</button><button className="secondary-button" type="button" onClick={downloadTrainingPack}>Download {trainingCaptureCount} saved examples</button></div>{trainingCaptureStatus && <p className="status" role="status">{trainingCaptureStatus}</p>}</details>}{pendingAction && <div className="action-proposal"><strong>Live page action ready: {pendingAction.label}</strong><pre>{pendingAction.selector ? `selector: ${pendingAction.selector}` : pendingAction.code}</pre><button className="primary-button" type="button" onClick={applyPendingAction}>Apply live edit</button></div>}{actionReceipt && <p className="action-receipt" role="status"><strong>{actionReceipt.label}</strong><span>{actionReceipt.detail}</span></p>}{mode === 'page' && <details className="page-console"><summary>Open live page tool console</summary><p>Runs JavaScript in the portfolio page context, not the visitor's operating-system terminal.</p><textarea aria-label="Live page JavaScript" rows={4} value={pageCode} onChange={(event) => setPageCode(event.target.value)} placeholder="document.body.style.background = 'black'; console.log('hello from the page tool');" /><button className="secondary-button" type="button" onClick={runPageCode} disabled={!pageCode.trim()}>Run JavaScript in page</button></details>}{agent.status === 'ready' && agent.result && <AnalysisResultView result={agent.result} />}</form></details>}
        {modelReady && <details className="experience-memory disabled-feature" aria-disabled="true"><summary>Give Dom verified experience stories <span>Coming later</span></summary><p>This read-only experience memory path is being rebuilt. It is visible for now but disabled until its import and review flow is verified.</p></details>}
      </section>

    </main>
  );
};

export default AgentApp;

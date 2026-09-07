import React from 'react';

import { AnalysisResultView } from './components/AnalysisResultView';
import { GoogleSheetPanel } from './components/GoogleSheetPanel';
import { createAnalyticsClient } from './lib/analytics';
import type { AnalysisResult } from './lib/deterministic-analysis';
import { browserModelForCurrentDevice, isMobileBrowser, LocalAiClient } from './lib/local-ai';
import { parseModelPlan } from './lib/model-plan';
import { PUBLIC_HANDOFF_LAB, publicModelForProfile, shortModelRevision } from './lib/public-model-registry';
import type { UploadedDataset } from './lib/upload';
import profileImage from '../profile1.jpg';
import type { ModelDevice, ModelWorkerResponse } from './workers/model.types';
import type { SchemaColumn } from './workers/analytics.types';

type AnalyticsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; schema: SchemaColumn[]; source: 'demo' | 'sheet' }
  | { status: 'error'; message: string };

type LocalAiState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'loading'; progress: number | null; loaded: number | null; total: number | null }
  | { status: 'ready'; output: string; result?: AnalysisResult }
  | { status: 'generating'; output: string }
  | { status: 'executing'; output: string }
  | { status: 'error'; message: string };

const formatBytes = (value: number | null) => {
  if (!value) return '';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const defaultPrompt = 'Group the rows by a useful category, count them, sort the counts descending, and choose an appropriate chart.';
const WORK_HISTORY_TIMELINE_URL = 'https://script.google.com/macros/s/AKfycbxOJtfZOW1WPxzQQ1lwAK7x_TkZGSRBJOPbgwViDQsnpNxAgynokJHDr7Xwh6SS6uJc/exec';

const promptForSchema = (request: string, schema: SchemaColumn[]) => {
  const fields = schema.length > 0
    ? schema.map((column) => `${column.name} (${column.type})`).join(', ')
    : 'id (number), name (text), age (number), salary (number)';
  return [
    'You are the browser analytics agent for Richard Jones portfolio.',
    'Return only one valid JSON analysis plan. Do not return SQL, JavaScript, markdown, or explanations.',
    'Allowed plan fields: filters, groupBy, aggregations, sort, limit, chart.',
    'Allowed aggregation operators: count, sum, avg, min, max. Allowed chart types: table, bar, line, scatter, auto.',
    `Dataset columns: ${fields}.`,
    `User request: ${request}`
  ].join('\n');
};

const App = () => {
  const mobileBrowser = isMobileBrowser();
  const timelineFrameRef = React.useRef<HTMLIFrameElement>(null);
  const browserModel = browserModelForCurrentDevice();
  const publicBrowserModel = publicModelForProfile(browserModel.profile);
  const [analytics, setAnalytics] = React.useState<AnalyticsState>({ status: 'idle' });
  const [localAi, setLocalAi] = React.useState<LocalAiState>({ status: 'idle' });
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [activeDataset, setActiveDataset] = React.useState<UploadedDataset | null>(null);
  const localAiClient = React.useRef<LocalAiClient | null>(null);
  const [modelDevice, setModelDevice] = React.useState<ModelDevice | null>(null);

  React.useEffect(() => () => localAiClient.current?.dispose(), []);

  const executeGeneratedPlan = async (raw: string) => {
    setLocalAi({ status: 'executing', output: raw });
    const client = createAnalyticsClient();
    try {
      const plan = parseModelPlan(raw);
      if (activeDataset) await client.loadUploadedDataset(activeDataset);
      else await client.loadDataset();
      const result = await client.executePlan(plan);
      setLocalAi({ status: 'ready', output: JSON.stringify(plan, null, 2), result });
    } catch (error) {
      setLocalAi({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      client.dispose();
    }
  };

  const handleModelMessage = (message: ModelWorkerResponse) => {
    if (message.type === 'model-progress') {
      setLocalAi({ status: 'loading', progress: message.progress, loaded: message.loaded, total: message.total });
    } else if (message.type === 'model-ready') {
      setModelDevice(message.device);
      setLocalAi({ status: 'ready', output: '' });
    } else if (message.type === 'generation-started') {
      setLocalAi({ status: 'generating', output: '' });
    } else if (message.type === 'generation-chunk') {
      setLocalAi((current) => ({
        status: 'generating',
        output: `${current.status === 'generating' ? current.output : ''}${message.text}`
      }));
    } else if (message.type === 'generation-complete') {
      void executeGeneratedPlan(message.text);
    } else if (message.type === 'model-error') {
      setLocalAi({ status: 'error', message: message.message });
    }
  };

  const launchLocalAi = async () => {
    setLocalAi({ status: 'checking' });
    setModelDevice(null);
    localAiClient.current ??= new LocalAiClient(handleModelMessage);
    try {
      await localAiClient.current.load();
    } catch (error) {
      setLocalAi({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const runLocalAi = () => {
    try {
      const schema = analytics.status === 'ready' ? analytics.schema : [];
      localAiClient.current?.generate(promptForSchema(prompt, schema));
    } catch (error) {
      setLocalAi({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const loadDemoSchema = async () => {
    setAnalytics({ status: 'loading' });
    const client = createAnalyticsClient();
    try {
      setActiveDataset(null);
      await client.loadDataset();
      setAnalytics({ status: 'ready', source: 'demo', schema: await client.inspectSchema() });
    } catch (error) {
      setAnalytics({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      client.dispose();
    }
  };

  const inspectSharedSheet = async (dataset: UploadedDataset) => {
    const client = createAnalyticsClient();
    try {
      await client.loadUploadedDataset(dataset);
      const schema = await client.inspectSchema();
      setActiveDataset(dataset);
      setAnalytics({ status: 'ready', source: 'sheet', schema });
      return schema;
    } finally {
      client.dispose();
    }
  };

  const isLoadingModel = localAi.status === 'checking' || localAi.status === 'loading';
  const canRunModel = localAi.status === 'ready';
  const agentRunning = localAi.status === 'generating' || localAi.status === 'executing';
  const timelineMode = mobileBrowser ? 'vertical' : 'horizontal';
  const timelineLayoutParams = React.useMemo(() => {
    const timelineUrl = new URL(WORK_HISTORY_TIMELINE_URL);
    timelineUrl.searchParams.set('v', '2');
    timelineUrl.searchParams.set('timelineLayout', timelineMode);
    return timelineUrl.toString();
  }, [timelineMode]);
  const syncTimelineFrame = () => {
    const frame = timelineFrameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'shoegun-timeline-mode', mobile: mobileBrowser, layout: timelineMode }, '*');
    frame.contentWindow.postMessage({ type: 'shoegun-timeline-layout', layout: timelineMode }, '*');
    frame.contentWindow.postMessage({ type: 'shoegun-timeline-resize-request' }, '*');
  };

  return (
    <main>
      <header className="site-header" id="home">
        <nav className="navbar" aria-label="Main navigation">
          <a className="navbar-brand" href="#home">Richard Jones</a>
          <ul className="navbar-nav">
            <li><a href="#about">About Me</a></li>
            <li><a href="#projects">Projects</a></li>
            <li><a href="#experiments">Experiments</a></li>
            <li><a href="#timeline">Work History</a></li>
            <li><a href="#analytics">Analytics</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>

        <section className="hero-section" aria-labelledby="portfolio-title">
          <div className="container hero-copy">
            <p className="eyebrow eyebrow-light">ANALYTICS &amp; ENGINEERING PORTFOLIO</p>
            <h1 id="portfolio-title">Shaping Data.<br />Driving Innovation.</h1>
            <p className="hero-lede">Unifying data engineering, advanced analytics, and operational strategy to modernize business solutions.</p>
            <p>Explore my portfolio of dynamic analytics, AI integrations, and transformative engineering projects.</p>
            <div className="hero-actions">
              <a className="button button-secondary" href="#analytics">Explore the analytics agent</a>
              <button type="button" className="button button-primary" onClick={launchLocalAi} disabled={isLoadingModel}>
                {localAi.status === 'checking' ? 'Checking browser acceleration' : localAi.status === 'loading' ? 'Loading local AI' : 'Launch local AI'}
              </button>
            </div>
          </div>
        </section>
      </header>

      <section id="about" className="portfolio-section about-section">
        <div className="container two-column">
          <div className="portrait-wrap"><img src={profileImage} alt="Richard Jones" /></div>
          <div>
            <p className="eyebrow">ABOUT ME</p>
            <h2>Operations, data, and useful software.</h2>
            <p>
              Hello! I&apos;m <strong>Richard Jones</strong> — an Operations Specialist, Data Engineer,
              Data Analyst, and full-stack developer who thrives on harnessing data to push boundaries
              and drive efficiency.
            </p>
            <p>
              From large-scale operations and compliance to AI-driven solutions and real-time analytics,
              my background covers banking, government, and freelance consulting.
            </p>
            <a className="text-link" href="https://www.linkedin.com/in/richardjones2020/" target="_blank" rel="noreferrer">Connect with me on LinkedIn</a>
          </div>
        </div>
      </section>

      <section id="projects" className="portfolio-section section-muted">
        <div className="container">
          <div className="section-heading"><p className="eyebrow">SELECTED WORK</p><h2>Featured Projects</h2></div>
          <div className="project-grid">
            <article className="project-card">
              <p className="card-kicker">CMS / GOOGLE APPS SCRIPT</p>
              <h3>Henry&apos;s Super Scoops CMS</h3>
              <p>A streamlined CMS built with Google Sheets and Apps Script, automating appointments, resource allocation, and Calendar sync for a free dessert-themed brand concept.</p>
              <div className="card-links"><a href="https://shoegun.github.io/Henry-s/learn-more.html" target="_blank" rel="noreferrer">Learn more</a><a href="https://shoegun.github.io/Henry-s/" target="_blank" rel="noreferrer">View project</a></div>
            </article>
            <article className="project-card">
              <p className="card-kicker">GEOSPATIAL ANALYTICS</p>
              <h3>Kepler in a Google Web App</h3>
              <p>Demonstrates the extensibility of Kepler.gl within Google Web Apps, with dynamic data loading from Sheets and interactive mapping.</p>
              <div className="card-links"><a href="https://script.google.com/macros/s/AKfycbyCSMyu_3Knjv0sq-UBT7SdF3fV9TfkILObnqfiauo5LgqpV5i_WbmtHU6AqWFVmtLj/exec" target="_blank" rel="noreferrer">View project</a></div>
            </article>
            <article className="project-card">
              <p className="card-kicker">ROUTE PLANNING</p>
              <h3>Altitude Directions App</h3>
              <p>A specialized route-planning tool that factors altitude thresholds, assisting divers, aviators, and altitude-sensitive users in safe and efficient route mapping.</p>
              <div className="card-links"><a href="https://script.google.com/macros/s/AKfycbynli9bhc36gqUIQmKtqnxa-jOcYmLrqsLsGNwGmuS2cdtUW7OjEyfUVQVJvl9_s9V5xw/exec" target="_blank" rel="noreferrer">View project</a></div>
            </article>
          </div>
        </div>
      </section>

      <section id="experiments" className="portfolio-section experiment-section">
        <div className="container">
          <div className="section-heading"><p className="eyebrow">OPEN MODEL LAB</p><h2>Capability handoff experiments</h2></div>
          <p className="section-intro">A working investigation into portable raw KV-cache tensors: capture a contained idea after one model processes it, verify the cache, and translate it into a compatible cache geometry so a smaller model can begin with that computational context.</p>
          <div className="experiment-grid">
            <article className="experiment-card experiment-live">
              <div className="experiment-status"><span aria-hidden="true" /> Exact-cache round trip verified</div>
              <p className="card-kicker">KVC1 / RAW KV TENSORS</p>
              <h3>Contained-idea cache handoff</h3>
              <p>An exact-model live round trip now passes locally on Qwen2.5-0.5B: KVC1 exported 48 actual attention tensors across 24 layers, then a separate process reconstructed the cache and resumed decoding with the same next token as uninterrupted inference. The maximum logit difference was 1.54e-5 inside a 5e-5 tolerance.</p>
              <p>The container binds immutable model and tokenizer identity, RoPE settings, tensor geometry, dtype, layout, sequence position, checksums, and an exact tensor directory. This proves real extraction and reinjection for one model/runtime—not translation or a capability increase yet.</p>
              <p>A translation contract now specifies the next bridge: source cache → versioned learned projector → destination-family cache, with source and translated artifacts preserved for before/after capability probes.</p>
              <p className="experiment-caveat">KV tensors are runtime activations, not model weights. Direct reuse requires compatible architecture and position semantics; cross-family transfer requires a trained translator and does not automatically preserve the larger model’s reasoning ability.</p>
              <div className="card-links"><a href="#analytics">See Dom’s context ledger</a><a href={PUBLIC_HANDOFF_LAB.hubUrl} target="_blank" rel="noreferrer">Inspect on Hugging Face</a></div>
            </article>
            <article className="experiment-card experiment-pending">
              <div className="experiment-status">Pending experiment</div>
              <p className="card-kicker">CONTINUAL LEARNING / DIRECTIONAL MEMORY</p>
              <h3>Competing ideas with explicit direction</h3>
              <p>Test whether a model can preserve two intentionally conflicting concepts by attaching task identity, relation type, provenance, temporal order, and a signed conflict direction—then retrieving or adapting the correct concept for the current conditions instead of averaging them together.</p>
              <p>The hypothesis is that conflict-aware routing and replay could reduce destructive interference in targeted cases while leaving compatible knowledge free to share. A related vector-memory study would augment similarity embeddings with directional relation channels, inspired by anisotropic and view-dependent representations in Gaussian splatting.</p>
              <p className="experiment-caveat">The splatting analogy motivates an experiment; it is not evidence that vector databases compress knowledge the same way or that the method solves catastrophic forgetting.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="timeline" className="portfolio-section">
        <div className="container">
          <div className="section-heading"><p className="eyebrow">EXPERIENCE</p><h2>Work History Timeline</h2></div>
          <p className="section-intro">A visual overview of my professional journey across analytics, operations, healthcare, government contracting, banking, and AI-led consulting.</p>
          <iframe
            ref={timelineFrameRef}
            className={`timeline-frame${mobileBrowser ? ' mobile-layout' : ''}`}
            src={timelineLayoutParams}
            loading="lazy"
            title="Work History Timeline"
            onLoad={syncTimelineFrame}
          />
        </div>
      </section>

      <section id="analytics" className="portfolio-section analytics-section">
        <div className="container">
          <div className="section-heading"><p className="eyebrow">BROWSER-NATIVE WEBGPU</p><h2>Analytics, with a local agent.</h2></div>
          <p className="section-intro">Connect an openly shared Google Sheet, ask a question in plain language, and let a small model propose a safe analysis plan. DuckDB-Wasm executes the validated plan in your browser.</p>
          <div className="agent-layout">
            <div className="agent-console" id="sheet-agent">
              <div className="agent-console-header">
                <div><span className="status-dot" aria-hidden="true" /> <strong>Local browser agent</strong></div>
                <a className="model-label" href={publicBrowserModel.hubUrl} target="_blank" rel="noreferrer">{browserModel.id} @ {shortModelRevision(browserModel.revision)}</a>
              </div>
              <p className="agent-note">No model files download until you launch it. {mobileBrowser ? 'A smaller mobile profile is selected for this device.' : 'The fullest experience is optimized for a computer with WebGPU.'} The browser cache can reuse the model on later visits.</p>
              {localAi.status === 'idle' && <p className="muted">Launch local AI above to activate the analysis workspace.</p>}
              {localAi.status === 'checking' && <p className="loading" role="status">Checking browser acceleration...</p>}
              {localAi.status === 'loading' && (
                <div className="model-progress" role="status" aria-live="polite">
                  <progress max="100" value={localAi.progress ?? undefined} />
                  <span>{localAi.progress === null ? 'Checking cache and model files' : `${Math.round(localAi.progress)}%`} {localAi.loaded && localAi.total ? `· ${formatBytes(localAi.loaded)} of ${formatBytes(localAi.total)}` : ''}</span>
                </div>
              )}
              {localAi.status === 'error' && <p className="error-state" role="alert">{localAi.message}</p>}
              {(canRunModel || localAi.status === 'generating' || localAi.status === 'executing') && (
                <div className="model-console">
                  {canRunModel && <p className="cache-state" role="status">Ready locally on {modelDevice === 'wasm' ? 'CPU WebAssembly fallback' : 'WebGPU'}. Your data stays in this browser.</p>}
                  <label htmlFor="local-ai-prompt">What should the agent analyze?</label>
                  <textarea id="local-ai-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} disabled={!canRunModel || agentRunning} />
                  <button type="button" className="button button-primary" onClick={runLocalAi} disabled={!canRunModel || !prompt.trim() || agentRunning}>
                    {localAi.status === 'generating' ? 'Generating locally' : localAi.status === 'executing' ? 'Validating plan' : 'Analyze and visualize'}
                  </button>
                  {localAi.output && <output aria-live="polite">{localAi.output}</output>}
                  {localAi.status === 'ready' && localAi.result && <AnalysisResultView result={localAi.result} />}
                </div>
              )}
            </div>
            <GoogleSheetPanel onInspect={inspectSharedSheet} />
          </div>

          <div className="demo-source">
            <div><p className="eyebrow">TRY IT WITHOUT A SHEET</p><h3>Demo dataset</h3><p>Load the small bundled example to inspect its schema before connecting your own public sheet.</p></div>
            <button type="button" className="button button-outline" onClick={loadDemoSchema} disabled={analytics.status === 'loading'}>{analytics.status === 'loading' ? 'Loading schema' : 'Load demo dataset'}</button>
          </div>
          {analytics.status === 'error' && <p className="error-state" role="alert">{analytics.message}</p>}
          {analytics.status === 'ready' && (
            <div className="schema-result"><p role="status"><strong>{analytics.source === 'sheet' ? 'Connected sheet' : 'Demo dataset'}</strong> · {analytics.schema.length} columns available to the agent.</p><table aria-label="Demo dataset schema"><thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Nullable</th></tr></thead><tbody>{analytics.schema.map((column) => <tr key={column.name}><td>{column.name}</td><td>{column.type}</td><td>{column.nullable ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>

      <section id="services" className="portfolio-section section-muted">
        <div className="container"><div className="section-heading"><p className="eyebrow">WHAT I DO</p><h2>Services</h2></div><div className="service-grid">
          <article className="service-card"><h3>Data Analysis &amp; Business Consulting</h3><p>Devising analytics strategies and refining business roadmaps to harness data-driven opportunities.</p></article>
          <article className="service-card"><h3>AI Consulting &amp; Integration</h3><p>Selecting, shaping, and integrating practical AI systems into real workflows, with skills spanning LLM evaluation, prompt and system design, local-first inference, browser AI, data grounding, and API integration.</p></article>
          <article className="service-card"><h3>Web &amp; Software Development</h3><p>Building secure, user-centric applications and websites with modern frameworks.</p></article>
          <article className="service-card"><h3>Automation &amp; Cloud Solutions</h3><p>Designing end-to-end automation scripts, cloud integrations, and scalable processes.</p></article>
        </div></div>
      </section>

      <section id="contact" className="portfolio-section contact-section">
        <div className="container two-column contact-grid"><div><p className="eyebrow">CONTACT</p><h2>Let&apos;s build something useful.</h2><p>Whether you need advanced data engineering, an AI-driven application, or streamlined process automation, I&apos;m ready to help bring the idea to life.</p></div><div className="contact-details"><a href="mailto:RichardX13@gmail.com">RichardX13@gmail.com</a><a href="tel:+14156974734">(415) 697-4734</a><a href="https://www.linkedin.com/in/richardjones2020/" target="_blank" rel="noreferrer">linkedin.com/in/richardjones2020</a></div></div>
      </section>

      <footer><div className="container footer-row"><span>© 2024 Richard Jones. All Rights Reserved.</span><div><a href="https://www.linkedin.com/in/richardjones2020/" target="_blank" rel="noreferrer">LinkedIn</a><a href="https://github.com/RichardJones2020" target="_blank" rel="noreferrer">GitHub</a><a href="mailto:RichardX13@gmail.com">Email</a></div></div></footer>
    </main>
  );
};

export default App;

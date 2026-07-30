import React from 'react';

import { createAnalyticsClient } from './lib/analytics';
import { LocalAiClient } from './lib/local-ai';
import { BROWSER_MODEL_ID, type ModelWorkerResponse } from './workers/model.types';
import type { SchemaColumn } from './workers/analytics.types';

type AnalyticsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; schema: SchemaColumn[] }
  | { status: 'error'; message: string };

type LocalAiState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'loading'; progress: number | null; loaded: number | null; total: number | null }
  | { status: 'ready'; output: string }
  | { status: 'generating'; output: string }
  | { status: 'error'; message: string };

const formatBytes = (value: number | null) => {
  if (!value) return '';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const App = () => {
  const [analytics, setAnalytics] = React.useState<AnalyticsState>({ status: 'idle' });
  const [localAi, setLocalAi] = React.useState<LocalAiState>({ status: 'idle' });
  const [prompt, setPrompt] = React.useState('Suggest a safe analysis plan for the demo dataset.');
  const localAiClient = React.useRef<LocalAiClient | null>(null);

  React.useEffect(() => () => localAiClient.current?.dispose(), []);

  const handleModelMessage = (message: ModelWorkerResponse) => {
    if (message.type === 'model-progress') {
      setLocalAi({
        status: 'loading',
        progress: message.progress,
        loaded: message.loaded,
        total: message.total
      });
    } else if (message.type === 'model-ready') {
      setLocalAi({ status: 'ready', output: '' });
    } else if (message.type === 'generation-started') {
      setLocalAi({ status: 'generating', output: '' });
    } else if (message.type === 'generation-chunk') {
      setLocalAi((current) => ({
        status: 'generating',
        output: `${current.status === 'generating' ? current.output : ''}${message.text}`
      }));
    } else if (message.type === 'generation-complete') {
      setLocalAi({ status: 'ready', output: message.text });
    } else if (message.type === 'model-error') {
      setLocalAi({ status: 'error', message: message.message });
    }
  };

  const launchLocalAi = async () => {
    setLocalAi({ status: 'checking' });
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
      localAiClient.current?.generate(prompt);
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
      await client.loadDataset();
      setAnalytics({ status: 'ready', schema: await client.inspectSchema() });
    } catch (error) {
      setAnalytics({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      client.dispose();
    }
  };

  return (
    <main>
      <header>
        <nav aria-label="Main navigation">
          <div className="nav-container">
            <div className="logo">ShoeGun</div>
            <ul>
              <li><a href="#about">About</a></li>
              <li><a href="#projects">Projects</a></li>
              <li><a href="#analytics">Analytics</a></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          </div>
        </nav>
        <section aria-labelledby="portfolio-title">
          <h1 id="portfolio-title">Richard Jones</h1>
          <p>Building applied analytics, automation, and local AI systems with a bias toward useful, inspectable software.</p>
          <button type="button" onClick={launchLocalAi} disabled={['checking', 'loading'].includes(localAi.status)}>
            {localAi.status === 'checking' ? 'Checking WebGPU' : localAi.status === 'loading' ? 'Loading local AI' : 'Launch local AI'}
          </button>
        </section>
      </header>

      <section id="local-ai" className="section local-ai-panel" aria-labelledby="local-ai-title">
        <div>
          <p className="eyebrow">BROWSER-NATIVE WEBGPU</p>
          <h2 id="local-ai-title">Local AI workspace</h2>
          <p>{BROWSER_MODEL_ID} runs in a dedicated worker. Model files download only after launch and are retained in the browser cache.</p>
        </div>

        {localAi.status === 'idle' && (
          <p className="muted">Launch the model above when you are ready to download it.</p>
        )}
        {localAi.status === 'checking' && (
          <p className="loading" role="status">Checking browser acceleration...</p>
        )}
        {localAi.status === 'loading' && (
          <div className="model-progress" role="status" aria-live="polite">
            <progress max="100" value={localAi.progress ?? undefined} />
            <span>
              {localAi.progress === null ? 'Checking cache and model files' : `${Math.round(localAi.progress)}%`}
              {localAi.loaded && localAi.total ? ` - ${formatBytes(localAi.loaded)} of ${formatBytes(localAi.total)}` : ''}
            </span>
          </div>
        )}
        {localAi.status === 'error' && (
          <p className="error-state" role="alert">{localAi.message}</p>
        )}
        {(localAi.status === 'ready' || localAi.status === 'generating') && (
          <div className="model-console">
            <label htmlFor="local-ai-prompt">Ask the browser model</label>
            <textarea
              id="local-ai-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              disabled={localAi.status === 'generating'}
            />
            <button type="button" onClick={runLocalAi} disabled={localAi.status === 'generating' || !prompt.trim()}>
              {localAi.status === 'generating' ? 'Generating locally' : 'Run on WebGPU'}
            </button>
            {localAi.output && <output aria-live="polite">{localAi.output}</output>}
          </div>
        )}
      </section>

      <section id="analytics" className="section analytics-panel">
        <div>
          <h2>Analytics Demo</h2>
          <p>Inspect the bundled demo dataset through a DuckDB-Wasm worker.</p>
          <button type="button" onClick={loadDemoSchema} disabled={analytics.status === 'loading'}>
            {analytics.status === 'loading' ? 'Loading schema' : 'Load demo dataset'}
          </button>
        </div>

        {analytics.status === 'idle' && (
          <p className="muted">Schema results will appear here after the worker loads the CSV.</p>
        )}

        {analytics.status === 'loading' && (
          <p className="loading" role="status" aria-live="polite">Loading analytics worker...</p>
        )}

        {analytics.status === 'error' && (
          <p className="error-state" role="alert">{analytics.message}</p>
        )}

        {analytics.status === 'ready' && (
          <table aria-label="Demo dataset schema">
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">Type</th>
                <th scope="col">Nullable</th>
              </tr>
            </thead>
            <tbody>
              {analytics.schema.map((column) => (
                <tr key={column.name}>
                  <td>{column.name}</td>
                  <td>{column.type}</td>
                  <td>{column.nullable ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="about" className="section">
        <h2>About</h2>
        <p>Analytics & Engineering Portfolio</p>
      </section>

      <section id="projects" className="section">
        <h2>Projects</h2>
        <div className="project-grid">
          <div className="project-card">Project 1</div>
          <div className="project-card">Project 2</div>
          <div className="project-card">Project 3</div>
        </div>
      </section>

      <section id="contact" className="section">
        <h2>Contact</h2>
        <p>Email: richard@example.com | LinkedIn: linkedin.com/in/richardjones</p>
      </section>
    </main>
  );
};

export default App;

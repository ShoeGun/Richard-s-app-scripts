import React from 'react';

import { createAnalyticsClient } from './lib/analytics';
import type { SchemaColumn } from './workers/analytics.types';

type AnalyticsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; schema: SchemaColumn[] }
  | { status: 'error'; message: string };

const App = () => {
  const [analytics, setAnalytics] = React.useState<AnalyticsState>({ status: 'idle' });

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
          <button type="button">Launch local AI</button>
        </section>
      </header>

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

import React from 'react';

import { fetchGoogleSheet } from '../lib/google-sheets';
import type { UploadedDataset } from '../lib/upload';
import type { SchemaColumn } from '../workers/analytics.types';

interface GoogleSheetPanelProps {
  onInspect: (dataset: UploadedDataset) => Promise<SchemaColumn[]>;
}

type SheetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; fileName: string; schema: SchemaColumn[] }
  | { status: 'error'; message: string };

const savedUrl = () => {
  try {
    return window.localStorage.getItem('shoegun-google-sheet-url') || '';
  } catch {
    return '';
  }
};

export function GoogleSheetPanel({ onInspect }: GoogleSheetPanelProps) {
  const [url, setUrl] = React.useState(savedUrl);
  const [state, setState] = React.useState<SheetState>({ status: 'idle' });

  const connectSheet = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ status: 'loading' });
    try {
      const dataset = await fetchGoogleSheet(url);
      const schema = await onInspect(dataset);
      try {
        window.localStorage.setItem('shoegun-google-sheet-url', url.trim());
      } catch {
        // A private browsing session may not provide local storage.
      }
      setState({ status: 'ready', fileName: dataset.fileName, schema });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  return (
    <div className="sheet-tool">
      <div>
        <p className="eyebrow">OPTIONAL DATA SOURCE</p>
        <h3>Connect a shared Google Sheet</h3>
        <p>
          Paste a read-only sharing link. The browser fetches its published CSV,
          sends it to the local analytics worker, and never asks for Google credentials.
        </p>
      </div>
      <form className="sheet-form" onSubmit={connectSheet}>
        <label htmlFor="google-sheet-url">Shared Google Sheet URL</label>
        <div className="sheet-input-row">
          <input
            id="google-sheet-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            required
          />
          <button type="submit" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Connecting...' : 'Connect sheet'}
          </button>
        </div>
      </form>
      <p className="sheet-note">
        The sheet must be public or published to the web. Private Sheets require a backend
        OAuth service, which this static GitHub Pages site intentionally does not use.
      </p>
      {state.status === 'error' && <p className="error-state" role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <div className="sheet-ready" role="status">
          <strong>{state.fileName}</strong> connected with {state.schema.length} columns.
          <span>Launch the browser agent below to build a plan and chart from this data.</span>
        </div>
      )}
    </div>
  );
}

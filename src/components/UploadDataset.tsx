import React from 'react';

import { readUploadedDataset, type UploadedDataset } from '../lib/upload';
import type { SchemaColumn } from '../workers/analytics.types';

interface UploadDatasetProps {
  onInspect: (dataset: UploadedDataset) => Promise<SchemaColumn[]>;
}

type UploadState =
  | { status: 'idle' }
  | { status: 'loading'; fileName: string }
  | { status: 'ready'; fileName: string; schema: SchemaColumn[] }
  | { status: 'error'; message: string };

export function UploadDataset({ onInspect }: UploadDatasetProps) {
  const [state, setState] = React.useState<UploadState>({ status: 'idle' });

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setState({ status: 'loading', fileName: file.name });
    try {
      const dataset = await readUploadedDataset(file);
      setState({
        status: 'ready',
        fileName: file.name,
        schema: await onInspect(dataset)
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      event.target.value = '';
    }
  };

  return (
    <section className="section upload-panel" aria-labelledby="upload-title">
      <div>
        <p className="eyebrow">YOUR DATA</p>
        <h2 id="upload-title">Inspect a local dataset</h2>
        <p>The selected CSV or JSON file is read in this browser and sent only to the application&apos;s local analytics worker.</p>
      </div>
      <label className="file-picker" htmlFor="dataset-upload">
        <span>Choose CSV or JSON</span>
        <input
          id="dataset-upload"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          onChange={handleFile}
        />
      </label>
      {state.status === 'loading' && <p role="status">Inspecting {state.fileName}...</p>}
      {state.status === 'error' && <p className="error-state" role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <div>
          <p role="status"><strong>{state.fileName}</strong>: {state.schema.length} columns detected.</p>
          <table aria-label={`Schema for ${state.fileName}`}>
            <thead>
              <tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Nullable</th></tr>
            </thead>
            <tbody>
              {state.schema.map((column) => (
                <tr key={column.name}>
                  <td>{column.name}</td>
                  <td>{column.type}</td>
                  <td>{column.nullable ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

import type {
  AnalyticsErrorCode,
  AnalyticsRequest,
  AnalyticsResponse,
  SchemaColumn
} from './analytics.types';

const DATASET_FILE_NAME = 'demo.csv';
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let datasetLoaded = false;

const duckDbBundles: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: mvpWasmUrl,
    mainWorker: mvpWorkerUrl
  },
  eh: {
    mainModule: ehWasmUrl,
    mainWorker: ehWorkerUrl
  }
};

function defaultDatasetUrl() {
  return new URL(`${import.meta.env.BASE_URL}data/demo.csv`, self.location.origin).href;
}

function analyticsError(code: AnalyticsErrorCode, error: unknown) {
  return {
    code,
    message: error instanceof Error ? error.message : String(error)
  };
}

function errorResponse(requestId: string, code: AnalyticsErrorCode, error: unknown): AnalyticsResponse {
  return {
    type: 'analytics-error',
    requestId,
    ok: false,
    error: analyticsError(code, error)
  };
}

async function initializeDuckDb() {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const bundle = await duckdb.selectBundle(duckDbBundles);
    if (!bundle.mainWorker) throw new Error('DuckDB worker asset unavailable for this browser.');

    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(
      new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
      worker
    );
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })();

  try {
    return await dbPromise;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
}

async function loadDataset(datasetUrl = defaultDatasetUrl()) {
  const db = await initializeDuckDb();
  const connection = await db.connect();
  try {
    await db.registerFileURL(
      DATASET_FILE_NAME,
      datasetUrl,
      duckdb.DuckDBDataProtocol.HTTP,
      false
    );
    await connection.query(`
      CREATE OR REPLACE TABLE demo AS
      SELECT * FROM read_csv_auto('${DATASET_FILE_NAME}', header = true)
    `);
    datasetLoaded = true;
  } finally {
    await connection.close();
  }
}

async function inspectSchema(): Promise<SchemaColumn[]> {
  if (!datasetLoaded) await loadDataset();

  const db = await initializeDuckDb();
  const connection = await db.connect();
  try {
    const result = await connection.query('DESCRIBE demo');
    const names = result.getChild('column_name');
    const types = result.getChild('column_type');
    const nullability = result.getChild('null');

    if (!names || !types || !nullability) {
      throw new Error('DESCRIBE returned an unexpected schema shape.');
    }

    const schema: SchemaColumn[] = [];
    for (let index = 0; index < result.numRows; index += 1) {
      schema.push({
        name: String(names.get(index)),
        type: String(types.get(index)),
        nullable: String(nullability.get(index)).toUpperCase() === 'YES'
      });
    }
    return schema;
  } finally {
    await connection.close();
  }
}

async function handleRequest(request: AnalyticsRequest): Promise<AnalyticsResponse> {
  try {
    switch (request.type) {
      case 'initialize':
        await initializeDuckDb();
        return { type: 'initialized', requestId: request.requestId, ok: true };
      case 'load-dataset':
        await loadDataset(request.datasetUrl);
        return { type: 'dataset-loaded', requestId: request.requestId, ok: true };
      case 'inspect-schema':
        return {
          type: 'schema-inspected',
          requestId: request.requestId,
          ok: true,
          schema: await inspectSchema()
        };
    }
  } catch (error) {
    const code = request.type === 'initialize'
      ? 'INITIALIZATION_FAILED'
      : request.type === 'load-dataset'
        ? 'DATASET_LOAD_FAILED'
        : 'SCHEMA_INSPECTION_FAILED';
    return errorResponse(request.requestId, code, error);
  }
}

self.addEventListener('message', async (event: MessageEvent<AnalyticsRequest>) => {
  const request = event.data;
  if (!request || typeof request.requestId !== 'string') {
    self.postMessage(errorResponse('unknown', 'INVALID_REQUEST', 'Invalid analytics worker request.'));
    return;
  }

  self.postMessage(await handleRequest(request));
});

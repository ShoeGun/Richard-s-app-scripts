# Active Operator Plan

## Goal

Complete the newly narrowed `T003`: establish the DuckDB-Wasm dependency, demo
dataset, and typed analytics worker protocol. `T003B` will implement the worker,
and `T003C` will connect it to the UI.

## Current Context

`T001` and `T002` are complete. The Vite/React/TypeScript scaffold and static UI
shell pass the current quality gates. Prior `T003` attempts failed because the
worker allowed out-of-focus edits, malformed JSON, directory edit paths, and
unrelated workflow changes. The orchestration platform now rejects those
proposals before applying them.

## Implementation Plan For T003

1. Add `@duckdb/duckdb-wasm` through `package.json` and `npm install`; do not
   hand-edit `package-lock.json`.
2. Add a small deterministic CSV under `public/data/`.
3. Define a typed request/response protocol under `src/workers/`.
4. Cover initialization, demo loading, schema inspection, request ids, and
   structured-clone-safe error responses in the protocol.
5. Keep this task to foundation files; do not implement the worker or UI yet.

## Expected Files

- `package.json`
- `package-lock.json`
- `public/data/demo.csv`
- `src/workers/analytics.types.ts`
- `src/workers/analytics.types.ts`
- `README.md`

## Do Not Touch

- `.github/workflows/pages.yml`
- `vite.config.ts`
- `TASKS.md`
- `WORKER_STATE.json`
- `worker/`
- deployment settings, model weights, secrets, or unrelated portfolio content

## Done Criteria

- DuckDB-Wasm is installed through the package manifest and lockfile.
- Demo CSV is deterministic and contains useful mixed column types.
- Protocol types cover every `T003B` request/response and serializable failures.
- `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` pass.
- No push or deployment occurs.

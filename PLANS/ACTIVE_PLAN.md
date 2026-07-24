# Active Operator Plan

## Goal

Complete `T003B`: repair the initial analytics protocol and implement the
DuckDB-Wasm analytics worker. `T003C` will connect it to the UI.

## Current Context

`T001`, `T002`, and `T003` are complete. The first `T003` protocol omitted
request correlation ids and used optional string errors; `T003B` must correct
that contract before implementing the worker. The reviewer now requires
evidence for every acceptance criterion.

## Implementation Plan For T003B

1. Add a request id to every request and response variant.
2. Replace optional string errors with a discriminated, structured-clone-safe
   error payload; do not use `any`.
3. Initialize DuckDB-Wasm in a Vite-managed Web Worker.
4. Load the existing demo CSV and return its schema as clone-safe primitives.
5. Use Vite/base-aware URLs for worker, Wasm, and public data assets.
6. Keep the main-thread client and UI out of this task.

## Expected Files

- `src/workers/analytics.types.ts`
- `src/workers/analytics.worker.ts`
- `README.md`

## Do Not Touch

- `.github/workflows/pages.yml`
- `vite.config.ts`
- `TASKS.md`
- `WORKER_STATE.json`
- `worker/`
- deployment settings, model weights, secrets, or unrelated portfolio content

## Done Criteria

- Every response can be correlated with its request.
- Errors and schema data cross the worker boundary without class instances.
- DuckDB-Wasm initializes off the main thread with production-safe asset URLs.
- The demo CSV loads and schema inspection returns useful column names/types.
- `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` pass.
- No push or deployment occurs.

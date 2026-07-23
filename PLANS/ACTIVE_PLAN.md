# Active Operator Plan

## Goal

Complete `T003`, the first real data vertical slice for EdgeOps Agent Studio:
load a bundled CSV through DuckDB-Wasm inside an analytics Web Worker and return
a structured, clone-safe schema to the React UI.

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
4. Initialize DuckDB-Wasm in `src/workers/analytics.worker.ts` using Vite `?url`
   asset imports so the configured GitHub Pages base applies to worker and WASM
   URLs.
5. Resolve the demo dataset from an explicit base URL supplied by the main
   thread. Do not hardcode localhost, `/data`, or a repository name.
6. Return only structured-clone-safe schema primitives and handled error
   responses.
7. Add a narrow analytics client on the main thread and show loading, success,
   schema, and error states without replacing the portfolio shell.
8. Unit-test request correlation and surfaced worker errors. Document that
   jsdom does not execute real nested workers/Wasm.

## Expected Files

- `package.json`
- `package-lock.json`
- `public/data/demo.csv`
- `src/workers/analytics.types.ts`
- `src/workers/analytics.worker.ts`
- `src/lib/analyticsClient.ts`
- focused React UI/test files under `src/`
- `README.md`

## Do Not Touch

- `.github/workflows/pages.yml`
- `vite.config.ts`
- `TASKS.md`
- `WORKER_STATE.json`
- `worker/`
- deployment settings, model weights, secrets, or unrelated portfolio content

## Done Criteria

- Demo CSV loads through the analytics worker.
- Schema inspection returns plain serializable values.
- Worker and DuckDB errors surface as handled UI states.
- Root and `/repo/` Vite builds resolve emitted assets correctly.
- `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` pass.
- No push or deployment occurs.

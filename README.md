# Richard-s-app-scripts
This is where my google apps scripts will live now!  

## Vite Setup
- Added Vite React TypeScript scaffold
- Updated scripts in package.json for build, serve, typecheck, lint, and test
- Configured Vite base for the user Pages path `/`

## GitHub Actions Workflow
- Updated .github/workflows/pages.yml to include Vite build steps

## DuckDB-Wasm Integration
- Added DuckDB-Wasm dependency through package.json and npm install
- Added a small deterministic CSV under `public/data/`
- Defined a typed request/response protocol under `src/workers/`
- Added `src/workers/analytics.worker.ts` so DuckDB initializes off the main
  thread with Vite-managed Wasm and worker asset URLs
- Analytics worker responses carry request ids and return only clone-safe schema
  primitives or typed handled errors

## Analytics Client
- Added a main-thread analytics client under `src/lib/analytics.ts`
- The client correlates every worker response by `requestId`
- The portfolio UI can load the demo dataset schema and render loading, success,
  and handled error states
- Tests mock the browser Worker API so request correlation and surfaced errors
  are covered without loading Wasm in jsdom

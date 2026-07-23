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
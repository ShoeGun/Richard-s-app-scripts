# Active Operator Plan

## Goal

Build a static GitHub Pages portfolio app that eventually showcases browser-side local AI. The existing `ShoeGun.github.io` portfolio stays the deployment target. Do not choose another host.

## PR / Issue Context

Current worker task `T001` is only the foundation: repair the failed Vite migration and create a valid Vite React TypeScript scaffold while preserving or intentionally migrating the existing portfolio content.

Later tasks will add the actual browser model flow:

- visitor clicks "Launch local AI"
- only then load model artifacts from an external CORS-compatible host such as Hugging Face Hub
- persistently cache model artifacts in the browser
- keep model weights and large binaries out of this repository
- validate model, dataset, worker, and WebAssembly URLs from the final GitHub Pages production path

## Implementation Plan For T001

1. Recover from the failed local-model scaffold attempt without resetting unrelated worker/escalation changes.
2. Inspect the current `HEAD` versions of portfolio files before editing content files.
3. Make `package.json` valid JSON with minimal Vite/React/TypeScript scripts and dependencies.
4. Use `index.html` as a Vite shell only.
5. Put React code under `src/`.
6. Preserve legacy portfolio content by migrating it into React or keeping legacy files unchanged as references.
7. Configure `vite.config.ts` with `base: process.env.VITE_BASE_PATH || "/"`.
8. Add or repair the GitHub Actions Pages workflow so it builds and uploads `dist`.
9. Run all required validation commands.

## Files Expected To Change For T001

- `package.json`
- `package-lock.json`
- `index.html`
- `src/`
- `vite.config.ts`
- `tsconfig.json`
- `eslint.config.js` or equivalent
- `.github/workflows/pages.yml`
- `README.md`

Leave `Code.gs`, root `style.css`, and root `script.js` unchanged unless their behavior/content is fully migrated and the reason is documented.

## Non-goals

- Do not deploy or push.
- Do not add model weights.
- Do not implement model loading before the scaffold is valid.
- Do not replace the portfolio with starter/demo copy.
- Do not truncate legacy files with placeholder comments.

## Done Criteria

- `npm install` succeeds.
- `npm run typecheck` succeeds.
- `npm run lint` succeeds.
- `npm run test` succeeds.
- `npm run build` succeeds and writes `dist`.
- Existing portfolio content is visibly preserved or explicitly migrated.
- Vite base defaults to `/` and supports override.
- GitHub Pages workflow builds `dist`.

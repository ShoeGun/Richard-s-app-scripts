# Test Patterns

Required command sequence for `T003`:

```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run build
$env:VITE_BASE_PATH='/repo/'
npm run build
Remove-Item Env:VITE_BASE_PATH
```

Worker-level regression checks:

```powershell
npm run test:worker
node worker/qwen-worker.mjs --doctor
```

Treat these as blockers:

- model proposal uses `src` or another directory as a file path;
- proposal edits `.github/`, `worker/`, task ledgers, or files outside `T003`
  focus;
- hardcoded localhost, `/data`, or repository-name asset paths;
- Arrow objects, database handles, `Error` instances, or unnormalized `bigint`
  values sent through `postMessage`;
- main-thread DuckDB execution;
- tests claiming jsdom proves real Wasm/worker loading;
- weakened typecheck, lint, test, build, or Pages workflow gates;
- placeholder file content or hand-authored `package-lock.json`.

Manual browser evidence after implementation:

- analytics worker script returns 200;
- selected DuckDB worker and Wasm assets return 200;
- `data/demo.csv` returns 200 under both `/` and `/repo/` base paths;
- schema rows render;
- invalid dataset URL produces a handled UI error.

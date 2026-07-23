# Test Patterns

Required command sequence for T001:

```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected failure patterns to treat as blockers:

- invalid `package.json`
- placeholder edit text in any source file
- blank starter portfolio replacing existing content
- missing ESLint config for `npm run lint`
- test script without at least one meaningful smoke/render test
- Vite base hardcoded to a project path instead of default `/`
- GitHub Pages workflow uploading anything other than `dist`

Future production-path checks:

- verify default Pages/custom-domain base `/`
- verify `VITE_BASE_PATH=/repo/ npm run build` works for project-repo paths
- validate model, dataset, worker, and WASM URLs from the deployed Pages origin, not localhost only

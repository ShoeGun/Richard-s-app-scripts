# Architecture

## Autonomous Worker

`worker/qwen-worker.mjs` is a project-local autonomous worker for `ShoeGun/ShoeGun.github.io`. It uses Ollama on `http://127.0.0.1:11434`, reads the repository memory files, selects one ready task from `TASKS.md`, asks local Qwen for bounded full-file edits, validates the result with allowlisted commands, reviews the Git diff, and commits successful checkpoints.

The worker is intentionally simple:

- No public server.
- No worker dependencies beyond Node, Git, npm, and Ollama.
- No access outside the repository.
- No shell metacharacter command chains.
- Persistent compact state in `WORKER_STATE.json`.
- Detailed runtime logs in ignored `worker/logs/`.
- PowerShell controls for start, pause, resume, stop, status, and doctor.
- Windows Scheduled Task persistence at login.

Primary model: `qwen3:8b`.

Fallback model: `qwen2.5-coder:7b`.

Initial context target: 16384 tokens.

The worker pauses when known GPU lock files exist or when GPU compute processes such as Voicebox or ComfyUI are active. It does not cancel those processes.

## Portfolio App Target

The static app should use Vite, React, and TypeScript while preserving or intentionally migrating the existing portfolio content currently represented by `index.html`, `style.css`, `script.js`, `profile.jpg`, `profile1.jpg`, and `Code.gs`. Browser workers should isolate model inference and deterministic analytics:

- UI thread: navigation, controls, accessibility states, chart rendering, and progress UI.
- Model worker: browser-compatible model loading, WebGPU checks, prompt-to-plan generation, structured output parsing, and telemetry visible to the user.
- Analytics worker: DuckDB-Wasm initialization, dataset loading, schema inference, validated plan execution, and result shaping.
- Shared schema package: Zod schemas for datasets, analysis plans, supported operations, chart suggestions, and validation errors.

The LLM plans. DuckDB calculates. Unsupported or unsafe plans are rejected before execution.

## GitHub Pages Deployment

This is a GitHub user Pages repository, so the production path is `https://shoegun.github.io/` and Vite should default to `base: "/"`. If the project moves to a project Pages repository later, the base path must be configurable, for example through `GITHUB_PAGES_BASE`.

Use a GitHub Actions Pages workflow that builds the static artifact and uploads `dist/` with `actions/upload-pages-artifact`, then deploys with `actions/deploy-pages`. The workflow must not require secrets for the static build.

Do not rely on server-side rewrites for client-side routing. Use hash routing or an equivalent static-safe routing design.

Large model artifacts must live outside the repo, such as on Hugging Face Hub with browser-compatible CORS. The deployed bundle should contain only app code, small demo datasets, icons, and docs-safe assets. Model downloads must happen only after the user clicks "Launch local AI" and should use persistent browser caching.

Production QA must validate model, dataset, worker, and WebAssembly asset URLs from the GitHub Pages origin, not only from `localhost`.

## Optional AWS Extension

The GitHub Pages build remains fully static and local-first. Documentation may describe an optional serverless extension:

- CloudFront and S3 for static hosting.
- API Gateway and Lambda for optional private dataset adapters.
- DynamoDB for saved catalog metadata or anonymized evaluation records.
- IAM least-privilege policies.
- AWS CDK skeleton only; no deployment without explicit user approval.

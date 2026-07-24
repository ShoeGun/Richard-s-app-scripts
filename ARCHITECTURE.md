# Architecture

## Autonomous Worker

`worker/qwen-worker.mjs` is the project-local execution runtime for `ShoeGun/ShoeGun.github.io`. It uses Ollama on `http://127.0.0.1:11434`, reads the repository memory files, selects one dependency-ready task from `TASKS.md`, asks a local model for bounded full-file edits, validates the proposal before touching disk, runs allowlisted commands, obtains an independent local review, and commits only the files owned by that proposal.

The worker is intentionally simple:

- No public server.
- No worker dependencies beyond Node, Git, npm, and Ollama.
- No access outside the repository.
- No shell metacharacter command chains.
- Persistent compact state in `WORKER_STATE.json`.
- Detailed runtime logs in ignored `worker/logs/`.
- Exact Ollama token counters and labeled frontier estimates in ignored `worker/runtime/`.
- PowerShell controls for start, pause, resume, stop, status, and doctor.
- Windows Scheduled Task persistence at login.
- Interrupted-task lease recovery without charging a model repair cycle.
- Task-focus enforcement: application tasks cannot edit orchestration files or unrelated workflow/config paths.
- Scoped commits: the worker never runs `git add -A`.

On-demand routing and compression utility: `qwen3.5:4b`.

Primary implementation model: `qwen3.5:9b`.

Repair and evidence-based review model: `qwen2.5-coder:14b`.

Slow local supervisor: `qwen3.6:latest`.

Initial context target: 16384 tokens.

The worker pauses when known GPU lock files exist or when GPU compute processes such as Voicebox or ComfyUI are active. It does not cancel those processes.

## Orchestration Modules

The platform has one authoritative execution ledger and several projections:

- Agentic OS provides governance, plans, guardrails, test patterns, and handoff/compaction rules.
- `TASKS.md` plus `WORKER_STATE.json` are the local execution ledger.
- `worker/lib/proposal.mjs` owns proposal validation, task focus, protected paths, and commit scope.
- `worker/lib/telemetry.mjs` owns inference event and aggregate token accounting.
- `worker/qwen-worker.mjs` owns task selection, model invocation, validation, repair, escalation, and local commits.
- `worker/loop-bridge.mjs` projects the loop and each task into Paperclip. Paperclip is a management view, not a competing task-state database.
- `worker/control-plane.mjs` serves the loopback dashboard at `http://127.0.0.1:3210`.

The dashboard can pause/resume/stop the worker, trigger a Paperclip sync, edit the operator plan/test patterns/guardrails, inspect the task graph and token ledger, and reorder enabled escalation channels. It is bound to loopback and rejects cross-origin mutation requests.

## Local-First Routing

The evidence-based default route is:

1. Deterministic rules select ready tasks and retrieve context without spending
   model tokens. `qwen3.5:4b` is available on demand for compression and schema
   repair when deterministic handling is insufficient.
2. `qwen3.5:9b` performs ordinary bounded implementation.
3. `qwen2.5-coder:14b` performs repairs and evidence-based diff review.
4. After the repair budget is exhausted, the 14B coder receives one compact
   read-only recovery packet.
5. `qwen3.6:latest` independently diagnoses stubborn failures as the final local
   supervisor.
6. GPT 5.4 receives a sparse guidance-only packet only after all local tiers fail.
7. GPT 5.6 is used only if the post-5.4 local retry still fails.

LiteLLM is not part of this worker's active request path. Models are addressed
directly through Ollama so provider failures and token accounting remain explicit.
LiteLLM may remain installed for separate experiments without appearing as a
required service in this control plane.

The dashboard monitors the Voice Platform gateway as `Voicebox`. A healthy
gateway with unavailable TTS is displayed as degraded rather than offline.
Voicebox does not participate in model routing and retains GPU priority when
actively using the device.

Other installed local models remain configurable experiments. A model is promoted only after the repository benchmark demonstrates valid structured output, focus compliance, and regression detection. "Uncensored" or "abliterated" is not a quality tier.

Frontier models never edit the repository in this loop. They return compact guidance, and a local worker applies and validates any resulting change.

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

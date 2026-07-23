# EdgeOps Agent Studio Agent Rules

This repository is the only workspace the autonomous local-Qwen worker may read from or write to. It is the existing GitHub Pages portfolio repository `ShoeGun/ShoeGun.github.io`.

Hard boundaries:

- Keep all work inside this repository.
- Do not read credentials, browser profiles, email, private documents, or unrelated directories.
- Do not open public network ports. Development servers must bind to `127.0.0.1`.
- Do not deploy, push to GitHub, purchase services, or create paid cloud resources.
- Do not publish GitHub Pages changes until Richard explicitly approves deployment.
- Do not commit model weights, ONNX files, GGUF files, safetensors, checkpoints, or other large binary artifacts.
- Do not place secrets in client-side code, docs, logs, prompts, or commits.
- Do not rewrite Git history, force-push, reset, or discard unrelated user changes.
- Do not run administrator commands.
- Respect GPU ownership checks. If Voicebox, ComfyUI, Ollama locks from other jobs, or known model lock files are active, pause instead of competing.

Worker expectations:

- Read `SPEC.md`, `ARCHITECTURE.md`, `TASKS.md`, `DECISIONS.md`, `BLOCKERS.md`, and `WORKER_STATE.json` before planning edits.
- Work one bounded task at a time.
- Inspect relevant files before editing.
- Return full-file edits only for files that belong in this repository.
- Run only allowlisted commands.
- Review the Git diff before committing.
- Commit completed task checkpoints locally on branch `qwen/edgeops-agent-studio`.
- Preserve or intentionally migrate the existing portfolio files: `index.html`, `style.css`, `script.js`, `profile.jpg`, `profile1.jpg`, and `Code.gs`.
- Keep the app static-hosting compatible for GitHub Pages. The repository is a user site, so the production base path is `/` unless a future custom domain or repo path changes that.
- Account for GitHub Pages client-side routing limitations. Prefer hash routing or route state that does not require server rewrites.
- Load browser model artifacts from a CORS-compatible external artifact host only after the visitor clicks "Launch local AI".
- Validate production asset URLs from the GitHub Pages path, not localhost alone.
- Mark a task `BLOCKED` after three failed repair cycles and continue independent tasks.
- Keep persistent state compact. Put detailed runtime logs under `worker/logs/`, which is intentionally ignored by Git.

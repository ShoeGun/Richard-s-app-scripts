# Decisions

## 2026-07-22: Use Project-Local Worker Fallback

Paperclip, LiteLLM, and OpenClaw are present locally, but the request warned that a previous Paperclip/Hermes run hung on approval prompts and explicitly allowed a project-local fallback. To avoid modifying third-party source code or chasing approval behavior, this repository uses a small local Ollama worker with durable files, bounded tasks, allowlisted commands, and Windows Scheduled Task persistence.

## 2026-07-22: Integrate With Existing GitHub Pages Portfolio

GitHub discovery found `ShoeGun/ShoeGun.github.io`, a public GitHub user Pages repository. The autonomous worker target is this repository on branch `qwen/edgeops-agent-studio`. The separate `edgeops-agent-studio` directory created during initial discovery is superseded and should be treated as scratch bootstrap evidence, not the deployment target.

## 2026-07-22: Pages Base And Routing

Because `ShoeGun.github.io` is a user Pages repository, Vite should default to `base: "/"`. Client-side routing must not require server rewrites; use hash routing or a static-safe equivalent. A future project Pages path can be supported through `GITHUB_PAGES_BASE`.

## 2026-07-22: Conservative Model Routing

Installed Qwen models include `qwen3:8b`, `qwen2.5-coder:7b`, and larger Qwen variants. The worker default is `qwen3:8b` for ordinary implementation, tests, docs, and repair. The fallback is `qwen2.5-coder:7b`, because it is coding-oriented and more suitable for the RTX 3070 than 14B/32B models.

## 2026-07-22: GPU Busy Means Pause

An active `voicebox-server-cuda.exe` process was observed during bootstrap. The worker treats known GPU owners as a pause condition and waits rather than cancelling or competing with them.

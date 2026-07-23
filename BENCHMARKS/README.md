# Local Model Benchmarks

Run the compact routing benchmark with installed Ollama models:

```powershell
node worker/benchmark-models.mjs
```

Pass explicit model names to compare a smaller set:

```powershell
node worker/benchmark-models.mjs qwen3:8b qwen2.5-coder:14b
```

The benchmark uses an 8K context, temperature zero, JSON mode, and unloads each
model after each case. It checks two failure modes seen in the real loop:

- respecting task focus and returning a file rather than a directory;
- rejecting an unrelated workflow change that weakens validation.

This is a routing smoke test, not a general leaderboard. Promotion still requires
the broader suite in `RESEARCH/local-model-routing-2026-07-23.md`.

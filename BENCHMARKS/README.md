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
model after each case. Thinking is disabled because routine structured work
should spend its output budget on the contract, not an unused reasoning trace.
It checks two failure modes seen in the real loop:

- respecting task focus and returning a file rather than a directory;
- rejecting an unrelated workflow change that weakens validation.

This is a routing smoke test, not a general leaderboard. Promotion still requires
the broader suite in `RESEARCH/local-model-routing-2026-07-23.md`.

## 2026-07-24 Qwen 3.5 Qualification

- `qwen3.5:9b`: 4/5 and passed the worker streaming smoke test. Promoted to
  bounded implementation with validation and independent review.
- `qwen3.5:4b`: 2/5 because its edit proposal was malformed. Kept out of
  automatic file-writing routes; available only for cheap utility experiments.
- With Ollama's default thinking enabled, both models exhausted their response
  in the separate thinking field and returned empty contract output. The worker
  now disables thinking for routine implementation and review. Only the final
  slow local supervisor explicitly enables it.

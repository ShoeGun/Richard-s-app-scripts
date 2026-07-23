# Extra Guardrails

- Do not push or deploy without explicit approval.
- Do not commit model weights or large binary artifacts.
- Keep GitHub Pages static hosting compatibility.
- Keep each task within its declared focus and exact commit paths.
- Do not stage the entire repository.
- Restore proposal-owned files after failed validation or review.
- Use 8K-16K retrieved context and compact evidence packets.
- Use exact Ollama token counters; label frontier counts as estimates.
- Use `qwen3:8b` for first attempts and `qwen2.5-coder:14b` for repair/review.
- Ask the 14B local escalation channel before GPT 5.4.
- Ask GPT 5.6 only after a post-GPT-5.4 local retry still fails.
- Frontier agents provide guidance only; the local worker applies changes.
- Do not promote an abliterated/uncensored checkpoint without benchmark evidence.
- Keep one substantial GPU workload resident at a time.
- A task is complete only after validation, independent review, scoped commit,
  and durable state/Paperclip evidence.

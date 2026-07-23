# Loop Engineering Ledger

This directory is the local, repo-native loop ledger for EdgeOps Agent Studio.

It exists so local model loops are inspectable, comparable, and improvable without digging through huge raw logs.

Primary loop:

- `edgeops-worker-loop.md` - human-readable loop state.
- `edgeops-worker-loop.json` - machine-readable loop state.
- `LOCAL_FIRST_ESCALATION.md` - operating guide for local-first work with tiered frontier/local escalation.

The loop bridge can also sync concise status comments into Paperclip. It must never include secrets, full raw model output, npm debug logs, browser profile data, or unrelated filesystem content.

Current default escalation ladder is `gpt-5.4 -> gpt-5.6`, with local Ollama channels available for experiments through `worker/config.json` and the helper scripts in the repository root.

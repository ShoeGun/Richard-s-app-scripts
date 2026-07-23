# Escalations

Generated escalation artifacts are ignored by Git:

- `outbox/` - compact unblock requests for ChatGPT or another reviewer.
- `inbox/` - answers to consume. Save as `<TASK_ID>.md`, for example `T001.md`.
- `processed/` - consumed answers.
- `local/` - local escalation model outputs.
- `frontier/` - Codex/frontier escalation outputs.

Default escalation ladder:

- `gpt-5.4` via `codex exec`, read-only, low reasoning.
- `gpt-5.6` via `codex exec`, read-only, medium reasoning, only after a post-5.4 local retry fails.

The worker asks exactly one frontier tier per blocked local repair cycle, then stops that iteration. The next loop tick resumes local work with the answer injected into the prompt. Frontier calls run from a temp scratch directory with only the compact escalation packet to avoid loading the whole repo context.

`gpt-5.6-*` requires Codex CLI `0.145.0` or newer. Run `codex --version` and `codex update` if the model reports that a newer Codex version is required.

Manual frontier flow remains available:

1. Open the latest file in `ESCALATIONS/outbox/`.
2. Paste it into the desired frontier model.
3. Save the answer:

```powershell
powershell -ExecutionPolicy Bypass -File .\answer-escalation.ps1 -TaskId T001 -Channel gpt-5.4 -FromClipboard
```

4. Resume the worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\resume-worker.ps1
```

Local model escalation flow:

```powershell
powershell -ExecutionPolicy Bypass -File .\ask-local-escalation.ps1 -TaskId T001 -Channel qwen-coder-local
```

Force a frontier channel now:

```powershell
powershell -ExecutionPolicy Bypass -File .\ask-frontier-escalation.ps1 -TaskId T001 -Channel gpt-5.4
```

Inspect or change the ladder:

```powershell
powershell -ExecutionPolicy Bypass -File .\show-escalation-config.ps1
powershell -ExecutionPolicy Bypass -File .\set-escalation-ladder.ps1 -Ladder "qwen-coder-local,gpt-5.4,gpt-5.6"
```

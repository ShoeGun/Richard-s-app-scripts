# Local-First Escalation Loop

This loop is designed to save frontier tokens.

## Intended Flow

1. Put the detailed plan in `PLANS/ACTIVE_PLAN.md`.
2. Put reusable test expectations in `PLANS/TEST_PATTERNS.md`.
3. Put extra safety or style constraints in `PLANS/GUARDRAILS.md`.
4. Let the local worker run tasks from `TASKS.md`.
5. If local repair fails repeatedly, the worker restores the files touched by the failed attempt and writes a compact unblock request to `ESCALATIONS/outbox/<TASK_ID>.md`.
6. The configured ladder asks one escalation tier, then stops the current iteration.
7. Default ladder: `gpt-5.4` first, then `gpt-5.6` if the post-5.4 local retry still cannot complete the task.
8. The worker injects the answer, resets the task to pending, and tries again locally on the next loop tick.

## Commands

Check loops:

```powershell
powershell -ExecutionPolicy Bypass -File .\worker-status.ps1
powershell -ExecutionPolicy Bypass -File .\loop-status.ps1
```

Answer a ChatGPT escalation from clipboard:

```powershell
powershell -ExecutionPolicy Bypass -File .\answer-escalation.ps1 -TaskId T001 -FromClipboard
powershell -ExecutionPolicy Bypass -File .\resume-worker.ps1
```

Ask a configured local escalation model:

```powershell
powershell -ExecutionPolicy Bypass -File .\ask-local-escalation.ps1 -TaskId T001 -Channel qwen-coder-local
```

Ask a configured frontier escalation channel:

```powershell
powershell -ExecutionPolicy Bypass -File .\ask-frontier-escalation.ps1 -TaskId T001 -Channel gpt-5.4
```

Inspect or change the ladder:

```powershell
powershell -ExecutionPolicy Bypass -File .\show-escalation-config.ps1
powershell -ExecutionPolicy Bypass -File .\set-escalation-ladder.ps1 -Ladder "gpt-5.4,gpt-5.6"
```

Add another Ollama escalation channel:

```powershell
powershell -ExecutionPolicy Bypass -File .\add-local-escalation-channel.ps1 `
  -Id qwen32-reviewer `
  -Model qwen3:32b `
  -Enabled `
  -AddToLadder
```

Add another Codex/frontier escalation channel:

```powershell
powershell -ExecutionPolicy Bypass -File .\add-frontier-escalation-channel.ps1 `
  -Id gpt-5.4-mini `
  -Model gpt-5.4-mini `
  -ReasoningEffort low `
  -Enabled `
  -AutoInvoke `
  -AddToLadder
```

## Token Discipline

Escalation requests intentionally include compact evidence only:

- task JSON
- operator plan/test/guardrail snippets
- last failure
- Git status
- diff stat

They avoid full logs, full model transcripts, secrets, and unrelated file contents.

Frontier channels run through `codex exec` from a temp scratch directory, with
project/user rules ignored, a read-only sandbox, no approvals, ephemeral sessions,
and compact final-answer capture under ignored `ESCALATIONS/frontier/`. The
escalation request itself carries the needed context; do not run frontier
escalations from the repo root unless explicitly debugging the loop.

`gpt-5.6-*` channels require Codex CLI `0.145.0` or newer. Check with:

```powershell
codex --version
```

Update with:

```powershell
codex update
```

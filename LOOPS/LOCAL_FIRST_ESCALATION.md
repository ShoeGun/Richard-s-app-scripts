# Local-First Escalation Loop

This loop is designed to save frontier tokens.

## Intended Flow

1. Put the detailed plan in `PLANS/ACTIVE_PLAN.md`.
2. Put reusable test expectations in `PLANS/TEST_PATTERNS.md`.
3. Put extra safety or style constraints in `PLANS/GUARDRAILS.md`.
4. Let the local worker run tasks from `TASKS.md`.
5. If local repair fails repeatedly, the worker writes a compact unblock request to `ESCALATIONS/outbox/<TASK_ID>.md`.
6. Use ChatGPT 5.4 only on that compact request.
7. Save the frontier answer to `ESCALATIONS/inbox/<TASK_ID>.md`.
8. The worker consumes the answer, resets the task to pending, and tries again locally.

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

Add another Ollama escalation channel:

```powershell
powershell -ExecutionPolicy Bypass -File .\add-local-escalation-channel.ps1 `
  -Id qwen32-reviewer `
  -Model qwen3:32b `
  -Enabled
```

## Token Discipline

Escalation requests intentionally include compact evidence only:

- task JSON
- operator plan/test/guardrail snippets
- last failure
- Git status
- diff stat

They avoid full logs, full model transcripts, secrets, and unrelated file contents.

